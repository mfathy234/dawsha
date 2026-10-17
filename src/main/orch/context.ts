import { createHash, randomBytes } from 'node:crypto'
import { moveTask } from '../../shared/orch/taskMachine'
import type { DecisionKind, OrchAgent, OrchDecision, OrchTask, TaskStatus } from '../../shared/orch/types'
import type { OrchStore } from './store'

export const MAX_REVIEW_ROUNDS = 2
export const MAX_TASKS_PER_RUN = 60
/** Open questions one agent may have waiting on the human at once. */
export const MAX_OPEN_DECISIONS_PER_AGENT = 3

export const ACTIVE: readonly TaskStatus[] = ['assigned', 'in_progress', 'stalled', 'blocked', 'waiting_on_human']
export const IN_REVIEW: readonly TaskStatus[] = ['done_pending_review', 'in_review']
/** Notes under these keys are written by Dawsha and the human only. */
export const RESERVED_NOTE_PREFIX = 'decision:'

/** A tool call the agent got wrong; reported back to it as a tool error, not a crash. */
export class OrchToolError extends Error {}

export const randomId = (prefix: string): string => `${prefix}_${randomBytes(5).toString('hex')}`
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
export const str = (value: unknown): string => (typeof value === 'string' ? value : '')
export const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
export const statusText = (status: TaskStatus): string => status.replace(/_/g, ' ')

export type NewTaskInput = Pick<OrchTask, 'title' | 'spec' | 'role' | 'dependsOn' | 'acceptance'> & { reviewOf?: string; review?: boolean }
export type NewDecisionInput = Pick<OrchDecision, 'question' | 'options' | 'recommended' | 'context' | 'taskId'> & {
  urgency?: OrchDecision['urgency']
}

/** Store access plus the small operations every part of the orchestrator shares. */
export class OrchContext {
  constructor(readonly store: OrchStore, readonly now: () => number) {}

  task(key: string, runId: string): OrchTask {
    const task = this.store.getTask(`${runId}:${key}`)
    if (!task) throw new OrchToolError(`Task ${key} not found in this run.`)
    return task
  }

  save(task: OrchTask): OrchTask {
    this.store.putTask(task)
    return task
  }

  move(task: OrchTask, to: TaskStatus): OrchTask {
    return this.save(moveTask(task, to, this.now()))
  }

  /** Retires the run's agents, closes its open questions and sets the final stage. */
  finishRun(runId: string, stage: 'done' | 'cancelled', why?: string): void {
    const run = this.store.getRun(runId)
    if (!run || run.stage === 'done' || run.stage === 'cancelled') return
    for (const agent of this.store.listAgents(runId).filter((a) => !a.retiredAt)) {
      this.store.putAgent({ ...agent, taskId: null, retiredAt: this.now() })
    }
    // Questions of a finished run can no longer be acted on.
    const answer = stage === 'cancelled' ? 'Run cancelled' : 'Run finished'
    for (const decision of this.store.listDecisions(runId).filter((d) => d.answer === null)) {
      this.store.putDecision({ ...decision, answer, answeredAt: this.now() })
    }
    if (why) this.log(runId, 'run', why, null)
    this.store.putRun({ ...run, stage, finishedAt: this.now() })
    this.log(runId, 'run', `Stage: ${stage}`, null)
  }

  log(runId: string, kind: string, text: string, taskId: string | null): void {
    this.store.addEvent({ runId, at: this.now(), kind, text, taskId })
  }

  message(runId: string, from: string, to: string | null, taskId: string | null, body: string): void {
    if (!to) return
    this.store.putMessage({ id: randomId('msg'), runId, from, to, taskId, body, createdAt: this.now(), readAt: null })
  }

  putNote(runId: string, key: string, text: string, author: string): { ok: true } {
    this.store.putNote({ runId, key, text, author, updatedAt: this.now() })
    return { ok: true }
  }

  newTask(runId: string, input: NewTaskInput): OrchTask {
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
      review: input.review === true,
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

  newDecision(agent: OrchAgent, kind: DecisionKind, input: NewDecisionInput): OrchDecision {
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

  activeTaskOf(agent: OrchAgent): OrchTask | undefined {
    return this.store.listTasks({ runId: agent.runId }).find((task) => task.assignee === agent.id && ACTIVE.includes(task.status))
  }

  requireWorkingTask(me: OrchAgent): OrchTask {
    const task = this.activeTaskOf(me)
    if (!task) throw new OrchToolError('You have no task. Call get_my_task first.')
    if (task.status !== 'in_progress') throw new OrchToolError(`${task.key} is ${statusText(task.status)}; it cannot be changed now.`)
    return task
  }

  nextReadyTask(me: OrchAgent): OrchTask | undefined {
    const tasks = this.store.listTasks({ runId: me.runId })
    const approved = new Set(tasks.filter((task) => task.status === 'approved').map((task) => task.key))
    return tasks.find((task) => task.role === me.role && task.status === 'todo' && task.dependsOn.every((key) => approved.has(key)))
  }

  /** Review tasks whose original was cancelled, approved or handed back are no longer needed. */
  cancelStaleReviews(runId: string): void {
    const tasks = this.store.listTasks({ runId })
    for (const review of tasks.filter((task) => task.reviewOf && task.status === 'todo')) {
      const original = tasks.find((task) => task.key === review.reviewOf)
      if (original && IN_REVIEW.includes(original.status)) continue
      this.move(review, 'cancelled')
      this.log(runId, 'task', `${review.key} cancelled: ${review.reviewOf} no longer needs this review`, review.id)
    }
  }
}
