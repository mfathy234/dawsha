import { randomBytes } from 'node:crypto'
import { REVIEWER_FOR, canUseTool } from '../../shared/orch/roles'
import { isFinal, moveTask, pauseTask, resumeTask } from '../../shared/orch/taskMachine'
import { TOOL_SCHEMAS, validateArgs, type ToolSchema } from '../../shared/orch/toolSchemas'
import { summarizeRunUsage, type PriceLookup, type RunUsage } from '../../shared/orch/usage'
import type {
  AgentUsage,
  DecisionKind,
  OrchAgent,
  OrchDecision,
  OrchEvent,
  OrchRole,
  OrchRun,
  OrchTask,
  OrchTaskState,
  RunKind,
  TaskStatus
} from '../../shared/orch/types'
import type { OrchStore } from './store'

export const MAX_REVIEW_ROUNDS = 2

/** A tool call the agent got wrong; reported back to it as a tool error, not a crash. */
export class OrchToolError extends Error {}

export interface CreateRunInput {
  /** Defaults to 'feature'. */
  kind?: RunKind
  projectPath: string
  title: string
  story: string
  plan: string
}

export interface HandoffInput {
  runner: string
  model: string
  /** Why the task changes hands, e.g. "Codex ran out of quota". Passed to the new agent. */
  note?: string
}

export interface RegisterAgentInput {
  runId: string
  role: OrchRole
  runner: string
  model: string
}

type Args = Record<string, unknown>
type Handler = (me: OrchAgent, args: Args) => unknown

const ACTIVE: readonly TaskStatus[] = ['assigned', 'in_progress', 'stalled', 'blocked', 'waiting_on_human']
const APPROVE = 'approve'
const TRY_AGAIN = 'try again'
const APPROVE_ANYWAY = 'approve anyway'
const CANCEL_TASK = 'cancel task'

function buildBrief(state: OrchTaskState): string {
  const { task, run, agent } = state
  const section = (title: string, body: string): string => (body.trim() ? `## ${title}\n${body.trim()}` : '')
  return [
    `# Continue task ${task.key}: ${task.title}`,
    `You are taking over this task${agent ? ` from the ${agent.role} agent (${agent.runner} · ${agent.model})` : ''}. ` +
      `Run "${run.title}" in ${run.projectPath}.`,
    section('Task spec', task.spec),
    section('Acceptance criteria', task.acceptance.map((c, i) => `${i + 1}. ${c}`).join('\n')),
    section('Status', `${task.status.replace(/_/g, ' ')}, review round ${task.reviewRound}`),
    section('Latest review or human feedback', task.feedback ?? ''),
    section('Progress so far', state.progress.map((line) => `- ${line}`).join('\n')),
    section('Last summary', task.summary ?? ''),
    section('Files and branch', [task.files.join(', '), task.branch ? `Branch: ${task.branch}` : ''].filter(Boolean).join('\n')),
    section('Shared notes', state.notes.map((n) => `- ${n.key}: ${n.text}`).join('\n')),
    section('Messages about this task', state.messages.map((m) => `- ${m.from}: ${m.body}`).join('\n')),
    'Pick up where it stopped: check the working tree and branch first, then call get_my_task and continue. Do not redo finished work.'
  ].filter(Boolean).join('\n\n')
}

const randomId = (prefix: string): string => `${prefix}_${randomBytes(5).toString('hex')}`
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const strList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

export class OrchService {
  private readonly handlers: Record<string, Handler> = {
    whoami: (me) => this.whoami(me),
    list_agents: (me) => this.listAgents(me),
    create_task: (me, args) => this.createTask(me, args),
    list_tasks: (me, args) => this.store.listTasks({ runId: me.runId, status: (str(args.status) || undefined) as TaskStatus | undefined }),
    get_my_task: (me) => this.getMyTask(me),
    update_task: (me, args) => this.updateTask(me, args),
    complete_task: (me, args) => this.completeTask(me, args),
    block_task: (me, args) => this.blockTask(me, args),
    submit_review: (me, args) => this.submitReview(me, args),
    send_message: (me, args) => this.sendMessage(me, args),
    fetch_inbox: (me) => this.fetchInbox(me),
    put_note: (me, args) => this.putNote(me.runId, str(args.key), str(args.text), me.id),
    get_notes: (me) => this.store.listNotes(me.runId).map(({ key, text, author }) => ({ key, text, author })),
    ask_human: (me, args) => this.askHuman(me, args)
  }

  constructor(private readonly store: OrchStore, private readonly now: () => number = Date.now) {}

  // ---- Host API (used by Dawsha itself, never by agents) ----

  createRun(input: CreateRunInput): OrchRun {
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
      createdAt: this.now(),
      finishedAt: null
    }
    this.store.putRun(run)
    this.log(run.id, 'run', `${kind === 'bug' ? 'Bug fix' : 'Run'} started: ${run.title}`, null)
    if (kind === 'bug') {
      const task = this.newTask(run.id, { title: run.title, spec: run.story, role: 'fixer', dependsOn: [], acceptance: [] })
      this.log(run.id, 'task', `${task.key} created for fixer: ${task.title}`, task.id)
    }
    return run
  }

  registerAgent(input: RegisterAgentInput): OrchAgent {
    const run = this.store.getRun(input.runId)
    if (!run) throw new Error(`Run ${input.runId} not found.`)
    if (run.kind === 'bug') this.checkBugAgent(input)
    const agent: OrchAgent = {
      id: randomId(input.role),
      ...input,
      token: randomBytes(24).toString('base64url'),
      taskId: null,
      createdAt: this.now(),
      usage: null,
      retiredAt: null
    }
    this.store.putAgent(agent)
    this.log(input.runId, 'agent', `${input.role} joined (${input.runner} · ${input.model})`, null)
    return agent
  }

  agentForToken(token: string): OrchAgent | undefined {
    const agent = token ? this.store.agentByToken(token) : undefined
    return agent && !agent.retiredAt ? agent : undefined
  }

  tasks(runId: string): OrchTask[] {
    return this.store.listTasks({ runId })
  }

  /** Called by the runner with the CLI session's latest cumulative token counts. */
  reportUsage(agentId: string, usage: AgentUsage): void {
    const agent = this.store.getAgent(agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found.`)
    this.store.putAgent({ ...agent, usage })
  }

  runUsage(runId: string, prices: PriceLookup): RunUsage {
    return summarizeRunUsage(this.store.listAgents(runId), prices)
  }

  toolsFor(agent: OrchAgent): ToolSchema[] {
    return TOOL_SCHEMAS.filter((schema) => canUseTool(agent.role, schema.name))
  }

  call(agent: OrchAgent, tool: string, args: unknown): unknown {
    const me = this.store.getAgent(agent.id)
    if (!me || me.retiredAt) throw new OrchToolError('This agent was replaced and can no longer work on the run.')
    if (!canUseTool(me.role, tool)) throw new OrchToolError(`The ${me.role} role is not allowed to use ${tool}.`)
    const problem = validateArgs(tool, args ?? {})
    if (problem) throw new OrchToolError(problem)
    return this.handlers[tool](me, (args ?? {}) as Args)
  }

  task(key: string, runId: string): OrchTask {
    const task = this.store.getTask(`${runId}:${key}`)
    if (!task) throw new OrchToolError(`Task ${key} not found in this run.`)
    return task
  }

  openDecisions(): OrchDecision[] {
    return this.store.openDecisions()
  }

  events(runId: string): OrchEvent[] {
    return this.store.listEvents(runId)
  }

  answerDecision(id: string, answer: string): OrchDecision {
    const decision = this.store.getDecision(id)
    if (!decision) throw new Error(`Decision ${id} not found.`)
    if (decision.answer !== null) throw new Error(`Decision ${id} was already answered.`)
    const answered: OrchDecision = { ...decision, answer, answeredAt: this.now() }
    this.store.putDecision(answered)
    this.putNote(decision.runId, `decision:${id}`, `Q: ${decision.question}\nA: ${answer}`, 'human')
    this.log(decision.runId, 'decision', `You answered: ${answer}`, decision.taskId)
    const task = decision.taskId ? this.store.getTask(decision.taskId) : undefined
    if (task) this.applyAnswer(answered, task, answer.trim())
    return answered
  }

  exportTaskState(runId: string, key: string): OrchTaskState {
    const run = this.store.getRun(runId)
    if (!run) throw new Error(`Run ${runId} not found.`)
    const task = this.task(key, runId)
    const agent = task.assignee ? this.store.getAgent(task.assignee) : undefined
    const state: OrchTaskState = {
      exportedAt: this.now(),
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
    const task = this.task(key, runId)
    if (isFinal(task.status)) throw new Error(`${key} is ${task.status} and cannot be handed over.`)
    const state = this.exportTaskState(runId, key)
    const previous = task.assignee ? this.store.getAgent(task.assignee) : undefined
    if (previous) this.store.putAgent({ ...previous, taskId: null, retiredAt: this.now() })
    const agent = this.registerAgent({ runId, role: task.role, runner: input.runner, model: input.model })
    const paused = task.status === 'blocked' || task.status === 'waiting_on_human'
    const working = task.status === 'in_progress' || task.status === 'stalled' || task.status === 'assigned'
    this.save({ ...task, assignee: agent.id, status: working ? 'assigned' : task.status, updatedAt: this.now() })
    this.store.putAgent({ ...agent, taskId: task.id })
    if (paused) {
      for (const decision of this.store.openDecisions().filter((d) => d.taskId === task.id)) {
        this.store.putDecision({ ...decision, agentId: agent.id })
      }
    }
    const note = input.note ? `\n\n## Note from the human\n${input.note}` : ''
    this.message(runId, 'dawsha', agent.id, task.id, state.brief + note)
    const from = previous ? `${previous.runner} · ${previous.model}` : 'nobody'
    this.log(runId, 'handoff', `${key} handed over from ${from} to ${input.runner} · ${input.model}`, task.id)
    return { agent: this.store.getAgent(agent.id) ?? agent, state }
  }

  // ---- Tools ----

  private whoami(me: OrchAgent): unknown {
    const run = this.store.getRun(me.runId)
    const task = this.activeTaskOf(me)
    return { agent_id: me.id, role: me.role, model: me.model, run_id: me.runId, run_title: run?.title ?? '', task: task?.key ?? null }
  }

  private listAgents(me: OrchAgent): unknown {
    return this.store.listAgents(me.runId).map((agent) => ({
      id: agent.id,
      role: agent.role,
      runner: agent.runner,
      model: agent.model,
      task: this.activeTaskOf(agent)?.key ?? null
    }))
  }

  private createTask(me: OrchAgent, args: Args): OrchTask {
    const dependsOn = strList(args.depends_on)
    for (const key of dependsOn) this.task(key, me.runId)
    const task = this.newTask(me.runId, {
      title: str(args.title),
      spec: str(args.spec),
      role: str(args.role) as OrchRole,
      dependsOn,
      acceptance: strList(args.acceptance)
    })
    this.log(me.runId, 'task', `${task.key} created for ${task.role}: ${task.title}`, task.id)
    return task
  }

  private getMyTask(me: OrchAgent): unknown {
    const current = this.activeTaskOf(me)
    if (current) {
      if (current.status !== 'assigned') return current
      return this.save(moveTask(current, 'in_progress', this.now()))
    }
    const next = this.nextReadyTask(me)
    if (!next) return { task: null, message: 'No task is ready for your role right now.' }
    const claimed = this.save({ ...moveTask(next, 'in_progress', this.now()), assignee: me.id })
    this.store.putAgent({ ...me, taskId: claimed.id })
    this.log(me.runId, 'task', `${me.role} started ${claimed.key}`, claimed.id)
    if (claimed.reviewOf) {
      const original = this.task(claimed.reviewOf, me.runId)
      if (original.status === 'done_pending_review') this.save(moveTask(original, 'in_review', this.now()))
    }
    return claimed
  }

  private updateTask(me: OrchAgent, args: Args): unknown {
    const task = this.requireWorkingTask(me)
    this.log(me.runId, 'progress', `${task.key}: ${str(args.progress)}`, task.id)
    return { ok: true }
  }

  private completeTask(me: OrchAgent, args: Args): unknown {
    const task = this.requireWorkingTask(me)
    if (task.reviewOf) throw new OrchToolError('This is a review task: use submit_review instead.')
    const tests = str(args.tests)
    const done: OrchTask = {
      ...task,
      summary: str(args.summary) + (tests ? `\nTests: ${tests}` : ''),
      files: strList(args.files),
      branch: str(args.branch) || task.branch,
      feedback: null
    }
    const reviewer = REVIEWER_FOR[task.role]
    if (reviewer) {
      this.save(moveTask(done, 'done_pending_review', this.now()))
      const review = this.newTask(me.runId, {
        title: `Review ${task.key}: ${task.title}`,
        spec: this.reviewSpec(done),
        role: reviewer,
        dependsOn: [],
        acceptance: task.acceptance,
        reviewOf: task.key
      })
      this.log(me.runId, 'task', `${task.key} finished, sent to review (${review.key})`, task.id)
      return { status: 'done_pending_review', review_task: review.key }
    }
    if (task.role === 'spec-writer') {
      this.save(moveTask(done, 'done_pending_review', this.now()))
      const run = this.store.getRun(me.runId)
      this.newDecision(me, 'spec-approval', {
        question: `Approve the spec for "${run?.title ?? task.title}"?`,
        options: ['Approve', 'Request changes'],
        recommended: null,
        context: [done.summary, ...done.files].filter(Boolean).join('\n'),
        taskId: task.id
      })
      this.log(me.runId, 'task', `${task.key} spec ready for your approval`, task.id)
      return { status: 'done_pending_review', message: 'The human will review the spec. Check fetch_inbox for their answer.' }
    }
    this.save(moveTask(done, 'approved', this.now()))
    this.log(me.runId, 'task', `${task.key} done`, task.id)
    return { status: 'approved' }
  }

  private blockTask(me: OrchAgent, args: Args): unknown {
    const task = this.requireWorkingTask(me)
    const reason = str(args.reason)
    this.save(pauseTask({ ...task, feedback: reason }, 'blocked', this.now()))
    const decision = this.newDecision(me, 'question', {
      question: `${task.key} is blocked: ${reason}`,
      options: ['Unblocked, continue', 'Cancel task'],
      recommended: null,
      context: task.spec,
      taskId: task.id
    })
    this.log(me.runId, 'task', `${task.key} blocked: ${reason}`, task.id)
    return { status: 'blocked', decision_id: decision.id }
  }

  private submitReview(me: OrchAgent, args: Args): unknown {
    const review = this.requireWorkingTask(me)
    if (!review.reviewOf) throw new OrchToolError('Your current task is not a review.')
    const comments = str(args.comments)
    const original = this.task(review.reviewOf, me.runId)
    this.save({ ...moveTask(review, 'approved', this.now()), summary: comments })
    if (args.verdict === APPROVE) {
      this.save(moveTask(original, 'approved', this.now()))
      this.message(me.runId, me.id, original.assignee, original.id, `Review of ${original.key} approved: ${comments}`)
      this.log(me.runId, 'review', `${original.key} approved by ${me.role}`, original.id)
      return { status: 'approved' }
    }
    const round = original.reviewRound + 1
    if (round >= MAX_REVIEW_ROUNDS) {
      const escalated: OrchTask = { ...original, reviewRound: round, feedback: comments, status: 'waiting_on_human', pausedFrom: 'in_progress', updatedAt: this.now() }
      this.save(escalated)
      this.newDecision(this.store.getAgent(original.assignee ?? '') ?? me, 'escalation', {
        question: `${original.key} "${original.title}" was rejected ${round} times. Latest review: ${comments}`,
        options: ['Try again', 'Approve anyway', 'Cancel task'],
        recommended: null,
        context: original.summary ?? '',
        taskId: original.id
      })
      this.log(me.runId, 'review', `${original.key} rejected ${round} times, escalated to you`, original.id)
      return { status: 'escalated' }
    }
    this.save({ ...moveTask(original, 'in_progress', this.now()), reviewRound: round, feedback: comments })
    this.message(me.runId, me.id, original.assignee, original.id, `Review of ${original.key} (round ${round}): changes requested.\n${comments}`)
    this.log(me.runId, 'review', `${original.key} rejected (round ${round}): ${comments}`, original.id)
    return { status: 'changes_requested', round }
  }

  private sendMessage(me: OrchAgent, args: Args): unknown {
    const to = str(args.to)
    const agents = this.store.listAgents(me.runId).filter((agent) => agent.id === to || agent.role === to)
    if (agents.length === 0) throw new OrchToolError(`No agent or role called "${to}" in this run.`)
    const taskKey = str(args.task)
    const taskId = taskKey ? this.task(taskKey, me.runId).id : null
    for (const agent of agents) this.message(me.runId, me.id, agent.id, taskId, str(args.body))
    return { sent_to: agents.map((agent) => agent.id) }
  }

  private fetchInbox(me: OrchAgent): unknown {
    const now = this.now()
    return this.store.unreadFor(me.id).map((message) => {
      this.store.putMessage({ ...message, readAt: now })
      const task = message.taskId ? this.store.getTask(message.taskId) : undefined
      return { from: message.from, task: task?.key ?? null, body: message.body, at: message.createdAt }
    })
  }

  private askHuman(me: OrchAgent, args: Args): unknown {
    const task = this.activeTaskOf(me)
    const recommended = typeof args.recommended === 'number' ? args.recommended : null
    const decision = this.newDecision(me, 'question', {
      question: str(args.question),
      options: strList(args.options),
      recommended,
      context: str(args.context),
      taskId: task?.id ?? null,
      urgency: args.urgency === 'high' ? 'high' : 'normal'
    })
    if (task && !isFinal(task.status)) this.save(pauseTask(task, 'waiting_on_human', this.now()))
    this.log(me.runId, 'decision', `${me.role} asked you: ${decision.question}`, task?.id ?? null)
    return { decision_id: decision.id, status: 'waiting', message: 'Your task is paused until the human answers. The answer arrives in fetch_inbox.' }
  }

  // ---- Answers ----

  private applyAnswer(decision: OrchDecision, task: OrchTask, answer: string): void {
    const now = this.now()
    const lower = answer.toLowerCase()
    const tell = (body: string): void => this.message(decision.runId, 'human', decision.agentId, task.id, body)
    if (decision.kind === 'spec-approval') {
      if (lower === APPROVE) {
        this.save(moveTask(task, 'approved', now))
        tell('The human approved the spec.')
      } else {
        this.save({ ...moveTask(task, 'in_progress', now), feedback: answer })
        tell(`The human asked for spec changes:\n${answer}`)
      }
      return
    }
    if (task.status !== 'blocked' && task.status !== 'waiting_on_human') {
      tell(`The human answered "${decision.question}": ${answer}`)
      return
    }
    if (lower === CANCEL_TASK) {
      this.save(moveTask(task, 'cancelled', now))
      tell(`The human cancelled ${task.key}.`)
      return
    }
    const resumed = resumeTask(task, now)
    if (decision.kind === 'escalation') {
      if (lower === APPROVE_ANYWAY) {
        this.save(moveTask(resumed, 'approved', now))
        tell(`The human approved ${task.key} despite the review.`)
        return
      }
      this.save({ ...resumed, reviewRound: 0, feedback: lower === TRY_AGAIN ? task.feedback : answer })
      tell(`The human wants another attempt at ${task.key}. ${lower === TRY_AGAIN ? `Latest review: ${task.feedback ?? ''}` : answer}`)
      return
    }
    this.save(resumed)
    tell(`The human answered "${decision.question}": ${answer}`)
  }

  // ---- Helpers ----

  private checkBugAgent(input: RegisterAgentInput): void {
    if (input.role !== 'fixer') throw new Error('Bug runs use one fixer agent and no subagents.')
    const working = this.store.listAgents(input.runId).some((agent) => agent.role === 'fixer' && !agent.retiredAt)
    if (working) throw new Error('This bug run already has a fixer. Hand the task over to continue with another model.')
  }

  private activeTaskOf(agent: OrchAgent): OrchTask | undefined {
    return this.store.listTasks({ runId: agent.runId }).find((task) => task.assignee === agent.id && ACTIVE.includes(task.status))
  }

  private requireWorkingTask(me: OrchAgent): OrchTask {
    const task = this.activeTaskOf(me)
    if (!task) throw new OrchToolError('You have no task. Call get_my_task first.')
    if (task.status !== 'in_progress') throw new OrchToolError(`${task.key} is ${task.status.replace(/_/g, ' ')}; it cannot be changed now.`)
    return task
  }

  private nextReadyTask(me: OrchAgent): OrchTask | undefined {
    const tasks = this.store.listTasks({ runId: me.runId })
    const approved = new Set(tasks.filter((task) => task.status === 'approved').map((task) => task.key))
    return tasks.find((task) => task.role === me.role && task.status === 'todo' && task.dependsOn.every((key) => approved.has(key)))
  }

  private newTask(runId: string, input: Pick<OrchTask, 'title' | 'spec' | 'role' | 'dependsOn' | 'acceptance'> & { reviewOf?: string }): OrchTask {
    const key = `T-${this.store.nextTaskNumber(runId)}`
    const now = this.now()
    return this.save({
      id: `${runId}:${key}`,
      key,
      runId,
      title: input.title,
      spec: input.spec,
      role: input.role,
      status: 'todo',
      dependsOn: input.dependsOn,
      acceptance: input.acceptance,
      reviewOf: input.reviewOf ?? null,
      reviewRound: 0,
      assignee: null,
      summary: null,
      files: [],
      branch: null,
      feedback: null,
      pausedFrom: null,
      createdAt: now,
      updatedAt: now
    })
  }

  private reviewSpec(task: OrchTask): string {
    return [
      `Review ${task.key} "${task.title}" (round ${task.reviewRound + 1} of ${MAX_REVIEW_ROUNDS}).`,
      `Task spec:\n${task.spec}`,
      task.acceptance.length ? `Acceptance criteria:\n${task.acceptance.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : '',
      `Summary from the author:\n${task.summary ?? ''}`,
      task.files.length ? `Files: ${task.files.join(', ')}` : '',
      task.branch ? `Branch: ${task.branch}` : '',
      'Approve only if every criterion is met. When rejecting, say exactly what to change.'
    ].filter(Boolean).join('\n\n')
  }

  private newDecision(
    agent: OrchAgent,
    kind: DecisionKind,
    input: Pick<OrchDecision, 'question' | 'options' | 'recommended' | 'context' | 'taskId'> & { urgency?: OrchDecision['urgency'] }
  ): OrchDecision {
    const decision: OrchDecision = {
      id: randomId('dec'),
      runId: agent.runId,
      kind,
      agentId: agent.id,
      urgency: input.urgency ?? 'normal',
      answer: null,
      createdAt: this.now(),
      answeredAt: null,
      question: input.question,
      options: input.options,
      recommended: input.recommended,
      context: input.context,
      taskId: input.taskId
    }
    this.store.putDecision(decision)
    return decision
  }

  private message(runId: string, from: string, to: string | null, taskId: string | null, body: string): void {
    if (!to) return
    this.store.putMessage({ id: randomId('msg'), runId, from, to, taskId, body, createdAt: this.now(), readAt: null })
  }

  private putNote(runId: string, key: string, text: string, author: string): unknown {
    this.store.putNote({ runId, key, text, author, updatedAt: this.now() })
    return { ok: true }
  }

  private save(task: OrchTask): OrchTask {
    this.store.putTask(task)
    return task
  }

  private log(runId: string, kind: string, text: string, taskId: string | null): void {
    this.store.addEvent({ runId, at: this.now(), kind, text, taskId })
  }
}
