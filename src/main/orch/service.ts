import { createStoredRun } from './runCreation'
import type { RunArchive } from '../../shared/orch/runArchive'
import { exportStoredRun, importStoredRun } from './archiveStore'
import { randomBytes } from 'node:crypto'
import { canUseTool } from '../../shared/orch/roles'
import { TOOL_SCHEMAS, validateArgs, type ToolSchema } from '../../shared/orch/toolSchemas'
import { summarizeRunUsage, type PriceLookup, type RunUsage } from '../../shared/orch/usage'
import type { OrchLaunch } from '../../shared/orch/launch'
import { moveTask } from '../../shared/orch/taskMachine'
import type { AgentUsage, OrchAgent, OrchDecision, OrchEvent, OrchRole, OrchRun, OrchTask, OrchTaskState, RunKind, RunStage } from '../../shared/orch/types'
import { applyAnswer } from './answers'
import { ACTIVE, OrchContext, OrchToolError, RESERVED_NOTE_PREFIX, hashToken, randomId, statusText } from './context'
import type { OrchStore } from './store'
import { buildBrief } from './text'
import { createToolHandlers, type ToolHandler } from './tools'

export { MAX_OPEN_DECISIONS_PER_AGENT, MAX_REVIEW_ROUNDS, MAX_TASKS_PER_RUN, OrchToolError } from './context'

export interface CreateRunInput {
  /** Defaults to 'feature'. */
  kind?: RunKind
  projectPath: string
  projectId?: string | null
  title: string
  story: string
  plan: string
  /** Stop for the human to approve the spec; defaults to true. */
  specApproval?: boolean
  /** Bug runs: the profile picked for the fixer. */
  fixerProfileId?: string | null
}

/** A pane or CLI that dies this many times on one task makes Dawsha ask the human. */
export const MAX_TASK_ATTEMPTS = 2

export interface RegisterAgentInput {
  runId: string
  role: OrchRole
  runner: string
  model: string
}

export interface HandoffInput {
  runner: string
  model: string
  /** Why the task changes hands, e.g. "Codex ran out of quota". Passed to the new agent. */
  note?: string
}

/**
 * The orchestrator as Dawsha uses it: runs, agents, decisions, usage and handoffs. Agents reach it only
 * through call(), which the MCP server invokes with the agent behind the request's token.
 * Every public method runs in one transaction.
 */
export class OrchService {
  private readonly ctx: OrchContext
  private readonly handlers: Record<string, ToolHandler>
  private readonly listeners = new Set<() => void>()
  private depth = 0

  constructor(private readonly store: OrchStore, now: () => number = Date.now) {
    this.ctx = new OrchContext(store, now)
    this.handlers = createToolHandlers(this.ctx)
  }

  /** Called after every change that was committed; never for failed ones. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Runs fn in one transaction and tells listeners once the outermost one commits. */
  private tx<T>(fn: () => T): T {
    this.depth += 1
    let result: T
    try {
      result = this.store.transaction(fn)
    } finally {
      this.depth -= 1
    }
    if (this.depth === 0) for (const listener of this.listeners) listener()
    return result
  }

  exportRun(runId: string, version = '1.0.0'): RunArchive {
    return this.store.transaction(() => exportStoredRun(this.store, runId, version, this.ctx.now()))
  }

  importRun(archive: RunArchive, from = 'dawsharun'): OrchRun {
    return this.tx(() => importStoredRun(this.store, archive, this.ctx.now(), from))
  }

  private writable(runId: string): void {
    if (this.store.getRun(runId)?.imported) throw new Error('Imported runs are read-only.')
  }

  /** A feature started from the UI also gets its initial spec task. */
  startRun(input: CreateRunInput): OrchRun {
    return this.tx(() => createStoredRun(this.ctx, input, true))
  }

  createRun(input: CreateRunInput): OrchRun {
    return this.tx(() => createStoredRun(this.ctx, input, false))
  }

  /** Returns the agent with its plain token (shown once, for the pane's MCP config); only a hash is stored. */
  registerAgent(input: RegisterAgentInput): OrchAgent {
    return this.tx(() => {
      this.writable(input.runId)
      const run = this.store.getRun(input.runId)
      if (!run) throw new Error(`Run ${input.runId} not found.`)
      if (run.kind === 'bug') this.checkBugAgent(input)
      const agent: OrchAgent = {
        id: randomId(input.role),
        ...input,
        token: randomBytes(24).toString('base64url'),
        taskId: null,
        createdAt: this.ctx.now(),
        usage: null,
        retiredAt: null
      }
      this.store.putAgent({ ...agent, token: hashToken(agent.token) })
      this.ctx.log(input.runId, 'agent', `${input.role} joined (${input.runner} · ${input.model})`, null)
      return agent
    })
  }

  agentForToken(token: string): OrchAgent | undefined {
    const agent = token ? this.store.agentByToken(hashToken(token)) : undefined
    return agent && !agent.retiredAt ? agent : undefined
  }

  toolsFor(agent: OrchAgent): ToolSchema[] {
    return TOOL_SCHEMAS.filter((schema) => canUseTool(agent.role, schema.name))
  }

  call(agent: OrchAgent, tool: string, args: unknown): unknown {
    return this.tx(() => {
      const me = this.store.getAgent(agent.id)
      if (!me || me.retiredAt) throw new OrchToolError('This agent was replaced and can no longer work on the run.')
      if (!canUseTool(me.role, tool)) throw new OrchToolError(`The ${me.role} role is not allowed to use ${tool}.`)
      const problem = validateArgs(tool, args ?? {})
      if (problem) throw new OrchToolError(problem)
      this.store.putAgent({ ...me, lastCallAt: this.ctx.now() })
      return this.handlers[tool]({ ...me, lastCallAt: this.ctx.now() }, (args ?? {}) as Record<string, unknown>)
    })
  }

  task(key: string, runId: string): OrchTask {
    return this.ctx.task(key, runId)
  }

  run(id: string): OrchRun | undefined {
    return this.store.getRun(id)
  }

  runs(): OrchRun[] {
    return this.store.listRuns()
  }

  agent(id: string): OrchAgent | undefined {
    return this.store.getAgent(id)
  }

  agents(runId: string): OrchAgent[] {
    return this.store.listAgents(runId)
  }

  activeTask(agentId: string): OrchTask | undefined {
    const agent = this.store.getAgent(agentId)
    return agent ? this.ctx.activeTaskOf(agent) : undefined
  }

  unreadCount(agentId: string): number {
    return this.store.unreadFor(agentId).length
  }

  setStage(runId: string, stage: RunStage): void {
    this.tx(() => {
      this.writable(runId)
      const run = this.store.getRun(runId)
      if (!run || run.stage === stage) return
      const finished = stage === 'done' || stage === 'cancelled'
      this.store.putRun({ ...run, stage, finishedAt: finished ? this.ctx.now() : run.finishedAt })
      this.ctx.log(runId, 'run', `Stage: ${stage}`, null)
    })
  }

  /** Saves how the agent's pane is started (no token inside), so a restored pane can start it again. */
  setLaunch(agentId: string, launch: OrchLaunch): void {
    this.tx(() => {
      const agent = this.store.getAgent(agentId)
      if (!agent) throw new Error(`Agent ${agentId} not found.`)
      this.writable(agent.runId)
      this.store.putAgent({ ...agent, launch })
    })
  }

  /** A new token each time the pane starts; the previous one stops working. Returns the plain token. */
  rotateToken(agentId: string): string {
    return this.tx(() => {
      const agent = this.store.getAgent(agentId)
      if (!agent || agent.retiredAt) throw new Error(`Agent ${agentId} is not active.`)
      const token = randomBytes(24).toString('base64url')
      this.store.putAgent({ ...agent, token: hashToken(token) })
      return token
    })
  }

  /** Gives a waiting task to a specific agent; its get_my_task then returns it. */
  assignTask(runId: string, key: string, agentId: string): OrchTask {
    return this.tx(() => {
      this.writable(runId)
      const task = this.ctx.task(key, runId)
      const agent = this.store.getAgent(agentId)
      if (!agent || agent.retiredAt) throw new Error(`Agent ${agentId} is not active.`)
      const assigned = this.ctx.save({ ...moveTask(task, 'assigned', this.ctx.now()), assignee: agentId })
      this.store.putAgent({ ...agent, taskId: task.id })
      this.ctx.log(runId, 'task', `${key} assigned to ${agent.role} (${agent.runner} · ${agent.model})`, task.id)
      return assigned
    })
  }

  /** The agent's pane closed or its CLI exited: retire it and put its task back, or ask the human. */
  releaseAgent(agentId: string, reason: string): void {
    this.tx(() => {
      const agent = this.store.getAgent(agentId)
      if (!agent || agent.retiredAt) return
      const task = this.ctx.activeTaskOf(agent)
      this.store.putAgent({ ...agent, taskId: null, retiredAt: this.ctx.now() })
      if (!task) return
      const attempts = (task.attempts ?? 0) + 1
      if (attempts < MAX_TASK_ATTEMPTS) {
        this.ctx.save({ ...task, status: 'todo', assignee: null, pausedFrom: null, attempts, updatedAt: this.ctx.now() })
        this.ctx.log(agent.runId, 'task', `${task.key} back in the queue: ${reason}`, task.id)
        return
      }
      this.ctx.save({ ...task, status: 'blocked', pausedFrom: 'todo', assignee: null, attempts, updatedAt: this.ctx.now() })
      this.ctx.newDecision(agent, 'stall', {
        question: `${task.key} "${task.title}" stopped ${attempts} times. Last time: ${reason}`,
        options: ['Try again', 'Cancel task'],
        recommended: null,
        context: task.summary ?? task.spec,
        taskId: task.id
      })
      this.ctx.log(agent.runId, 'task', `${task.key} stopped ${attempts} times, asking you`, task.id)
    })
  }

  /** Quota hit or no progress: the task waits and the human picks another model, or waits. */
  reportStall(agentId: string, message: string, options: string[]): OrchDecision {
    return this.tx(() => {
      const agent = this.store.getAgent(agentId)
      if (!agent) throw new Error(`Agent ${agentId} not found.`)
      this.writable(agent.runId)
      const task = this.ctx.activeTaskOf(agent)
      if (!task) throw new Error(`Agent ${agentId} has no task.`)
      const open = this.store.openDecisions().find((d) => d.taskId === task.id && d.kind === 'stall')
      if (open) return open
      if (task.status === 'in_progress' || task.status === 'assigned') this.ctx.move(task, 'stalled')
      this.ctx.log(agent.runId, 'task', `${task.key} stalled: ${message}`, task.id)
      return this.ctx.newDecision(agent, 'stall', {
        question: `${task.key} "${task.title}" stopped: ${message}`,
        options,
        recommended: null,
        context: message,
        taskId: task.id
      })
    })
  }

  decisions(runId: string): OrchDecision[] {
    return this.store.listDecisions(runId)
  }

  /** A question from Dawsha itself (merge conflict, run finished), not from an agent. */
  raiseDecision(runId: string, kind: OrchDecision['kind'], input: Pick<OrchDecision, 'question' | 'options' | 'context' | 'taskId'>): OrchDecision {
    return this.tx(() => {
      this.writable(runId)
      const decision: OrchDecision = {
        id: randomId('dec'),
        runId,
        kind,
        agentId: null,
        urgency: 'normal',
        answer: null,
        createdAt: this.ctx.now(),
        answeredAt: null,
        recommended: null,
        ...input
      }
      this.store.putDecision(decision)
      this.ctx.log(runId, 'decision', `Dawsha asked you: ${input.question}`, input.taskId)
      return decision
    })
  }

  /** Ends the run: every agent's token stops working. */
  finishRun(runId: string, stage: 'done' | 'cancelled' = 'done'): void {
    this.tx(() => {
      for (const agent of this.store.listAgents(runId).filter((a) => !a.retiredAt)) {
        this.store.putAgent({ ...agent, taskId: null, retiredAt: this.ctx.now() })
      }
      this.setStage(runId, stage)
    })
  }

  markMerged(runId: string, key: string): void {
    this.tx(() => {
      this.writable(runId)
      const task = this.ctx.task(key, runId)
      this.ctx.save({ ...task, mergedAt: this.ctx.now() })
      this.ctx.log(runId, 'merge', `${key} merged into the run branch`, task.id)
    })
  }

  tasks(runId: string): OrchTask[] {
    return this.store.listTasks({ runId })
  }

  openDecisions(): OrchDecision[] {
    return this.store.openDecisions().filter((d) => !this.store.getRun(d.runId)?.imported)
  }

  events(runId: string): OrchEvent[] {
    return this.store.listEvents(runId)
  }

  answerDecision(id: string, answer: string): OrchDecision {
    return this.tx(() => {
      const decision = this.store.getDecision(id)
      if (!decision) throw new Error(`Decision ${id} not found.`)
      this.writable(decision.runId)
      if (decision.answer !== null) throw new Error(`Decision ${id} was already answered.`)
      const answered: OrchDecision = { ...decision, answer, answeredAt: this.ctx.now() }
      this.store.putDecision(answered)
      this.ctx.putNote(decision.runId, `${RESERVED_NOTE_PREFIX}${id}`, `Q: ${decision.question}\nA: ${answer}`, 'human')
      this.ctx.log(decision.runId, 'decision', `You answered: ${answer}`, decision.taskId)
      const task = decision.taskId ? this.store.getTask(decision.taskId) : undefined
      if (task) applyAnswer(this.ctx, answered, task, answer.trim())
      return answered
    })
  }

  /** Called by the runner with the CLI session's latest cumulative token counts. */
  reportUsage(agentId: string, usage: AgentUsage): void {
    this.tx(() => {
      const agent = this.store.getAgent(agentId)
      if (!agent) throw new Error(`Agent ${agentId} not found.`)
      this.writable(agent.runId)
      this.store.putAgent({ ...agent, usage })
    })
  }

  runUsage(runId: string, prices: PriceLookup): RunUsage {
    return summarizeRunUsage(this.store.listAgents(runId), prices)
  }

  exportTaskState(runId: string, key: string): OrchTaskState {
    const run = this.store.getRun(runId)
    if (!run) throw new Error(`Run ${runId} not found.`)
    const task = this.ctx.task(key, runId)
    const agent = task.assignee ? this.store.getAgent(task.assignee) : undefined
    const state: OrchTaskState = {
      exportedAt: this.ctx.now(),
      run: { id: run.id, title: run.title, story: run.story, projectPath: run.projectPath, plan: run.plan },
      task,
      agent: agent ? { id: agent.id, role: agent.role, runner: agent.runner, model: agent.model } : null,
      progress: this.store.listEvents(runId).filter((event) => event.taskId === task.id).map((event) => event.text),
      messages: this.store.listMessages(runId).filter((m) => m.taskId === task.id).map((m) => ({ from: m.from, body: m.body, at: m.createdAt })),
      notes: this.store.listNotes(runId).map(({ key: noteKey, text, author }) => ({ key: noteKey, text, author })),
      brief: ''
    }
    return { ...state, brief: buildBrief(state) }
  }

  /**
   * Gives an unfinished task to a new agent on another runner or model (quota ran out, or the human
   * chose to). The task keeps its branch, review round and history; the new agent gets a brief.
   */
  handoffTask(runId: string, key: string, input: HandoffInput): { agent: OrchAgent; state: OrchTaskState } {
    return this.tx(() => {
      this.writable(runId)
      const task = this.ctx.task(key, runId)
      if (!ACTIVE.includes(task.status)) {
        throw new Error(`${key} is ${statusText(task.status)}; only unfinished work that is not waiting for review can be handed over.`)
      }
      const state = this.exportTaskState(runId, key)
      const previous = task.assignee ? this.store.getAgent(task.assignee) : undefined
      if (previous) this.store.putAgent({ ...previous, taskId: null, retiredAt: this.ctx.now() })
      const agent = this.registerAgent({ runId, role: task.role, runner: input.runner, model: input.model })
      const paused = task.status === 'blocked' || task.status === 'waiting_on_human'
      this.ctx.save({ ...task, assignee: agent.id, status: paused ? task.status : 'assigned', updatedAt: this.ctx.now() })
      this.store.putAgent({ ...agent, token: hashToken(agent.token), taskId: task.id })
      for (const decision of this.store.openDecisions().filter((d) => d.taskId === task.id)) {
        this.store.putDecision({ ...decision, agentId: agent.id })
      }
      const note = input.note ? `\n\n## Note from the human\n${input.note}` : ''
      this.ctx.message(runId, 'dawsha', agent.id, task.id, state.brief + note)
      const from = previous ? `${previous.runner} · ${previous.model}` : 'nobody'
      this.ctx.log(runId, 'handoff', `${key} handed over from ${from} to ${input.runner} · ${input.model}`, task.id)
      return { agent: { ...agent, taskId: task.id }, state }
    })
  }

  private checkBugAgent(input: RegisterAgentInput): void {
    if (input.role !== 'fixer') throw new Error('Bug runs use one fixer agent and no subagents.')
    const working = this.store.listAgents(input.runId).some((agent) => agent.role === 'fixer' && !agent.retiredAt)
    if (working) throw new Error('This bug run already has a fixer. Hand the task over to continue with another model.')
  }
}
