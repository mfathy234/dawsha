import { randomBytes } from 'node:crypto'
import { canUseTool } from '../../shared/orch/roles'
import { TOOL_SCHEMAS, validateArgs, type ToolSchema } from '../../shared/orch/toolSchemas'
import { summarizeRunUsage, type PriceLookup, type RunUsage } from '../../shared/orch/usage'
import type { AgentUsage, OrchAgent, OrchDecision, OrchEvent, OrchRole, OrchRun, OrchTask, OrchTaskState, RunKind } from '../../shared/orch/types'
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
  title: string
  story: string
  plan: string
}

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

  constructor(private readonly store: OrchStore, now: () => number = Date.now) {
    this.ctx = new OrchContext(store, now)
    this.handlers = createToolHandlers(this.ctx)
  }

  createRun(input: CreateRunInput): OrchRun {
    return this.store.transaction(() => {
      const kind: RunKind = input.kind ?? 'feature'
      const run: OrchRun = {
        id: randomId('run'),
        kind,
        projectPath: input.projectPath,
        title: input.title,
        story: input.story,
        plan: input.plan,
        // A bug skips the spec and planning stages: one fixer works straight from the report.
        stage: kind === 'bug' ? 'build' : 'spec',
        createdAt: this.ctx.now(),
        finishedAt: null
      }
      this.store.putRun(run)
      this.ctx.log(run.id, 'run', `${kind === 'bug' ? 'Bug fix' : 'Run'} started: ${run.title}`, null)
      if (kind === 'bug') {
        const task = this.ctx.newTask(run.id, { title: run.title, spec: run.story, role: 'fixer', dependsOn: [], acceptance: [] })
        this.ctx.log(run.id, 'task', `${task.key} created for fixer: ${task.title}`, task.id)
      }
      return run
    })
  }

  /** Returns the agent with its plain token (shown once, for the pane's MCP config); only a hash is stored. */
  registerAgent(input: RegisterAgentInput): OrchAgent {
    return this.store.transaction(() => {
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
    return this.store.transaction(() => {
      const me = this.store.getAgent(agent.id)
      if (!me || me.retiredAt) throw new OrchToolError('This agent was replaced and can no longer work on the run.')
      if (!canUseTool(me.role, tool)) throw new OrchToolError(`The ${me.role} role is not allowed to use ${tool}.`)
      const problem = validateArgs(tool, args ?? {})
      if (problem) throw new OrchToolError(problem)
      return this.handlers[tool](me, (args ?? {}) as Record<string, unknown>)
    })
  }

  task(key: string, runId: string): OrchTask {
    return this.ctx.task(key, runId)
  }

  tasks(runId: string): OrchTask[] {
    return this.store.listTasks({ runId })
  }

  openDecisions(): OrchDecision[] {
    return this.store.openDecisions()
  }

  events(runId: string): OrchEvent[] {
    return this.store.listEvents(runId)
  }

  answerDecision(id: string, answer: string): OrchDecision {
    return this.store.transaction(() => {
      const decision = this.store.getDecision(id)
      if (!decision) throw new Error(`Decision ${id} not found.`)
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
    this.store.transaction(() => {
      const agent = this.store.getAgent(agentId)
      if (!agent) throw new Error(`Agent ${agentId} not found.`)
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
    return this.store.transaction(() => {
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
