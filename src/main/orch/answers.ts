import { resumeTask } from '../../shared/orch/taskMachine'
import type { OrchDecision, OrchTask } from '../../shared/orch/types'
import type { OrchContext } from './context'

const APPROVE = 'approve'
const TRY_AGAIN = 'try again'
const APPROVE_ANYWAY = 'approve anyway'
const CANCEL_TASK = 'cancel task'

/** Lower-cased, trimmed, without trailing punctuation: "Approve." and "approve" mean the same. */
export const normalizeAnswer = (answer: string): string => answer.trim().toLowerCase().replace(/[.!\s]+$/, '')

/** Moves the task the human just decided about and tells its agent. */
export function applyAnswer(ctx: OrchContext, decision: OrchDecision, task: OrchTask, answer: string): void {
  const tell = (body: string): void => ctx.message(decision.runId, 'human', decision.agentId, task.id, body)
  if (decision.kind === 'spec-approval') return applySpecAnswer(ctx, task, answer, tell)
  if (task.status !== 'blocked' && task.status !== 'waiting_on_human') {
    tell(`The human answered "${decision.question}": ${answer}`)
    return
  }
  const choice = normalizeAnswer(answer)
  if (choice === CANCEL_TASK) {
    ctx.move(task, 'cancelled')
    tell(`The human cancelled ${task.key}.`)
    return
  }
  const resumed = resumeTask(task, ctx.now())
  if (decision.kind === 'escalation') return applyEscalationAnswer(ctx, task, resumed, answer, tell)
  ctx.save(resumed)
  tell(`The human answered "${decision.question}": ${answer}`)
}

function applySpecAnswer(ctx: OrchContext, task: OrchTask, answer: string, tell: (body: string) => void): void {
  if (task.status !== 'done_pending_review') {
    tell(`The human answered about the spec of ${task.key}: ${answer}`)
    return
  }
  if (normalizeAnswer(answer) === APPROVE) {
    ctx.move(task, 'approved')
    tell('The human approved the spec.')
    return
  }
  ctx.save({ ...ctx.move(task, 'in_progress'), feedback: answer })
  tell(`The human asked for spec changes:\n${answer}`)
}

function applyEscalationAnswer(ctx: OrchContext, task: OrchTask, resumed: OrchTask, answer: string, tell: (body: string) => void): void {
  const choice = normalizeAnswer(answer)
  if (choice === APPROVE_ANYWAY) {
    ctx.move(resumed, 'approved')
    tell(`The human approved ${task.key} despite the review.`)
    return
  }
  const tryAgain = choice === TRY_AGAIN
  ctx.save({ ...resumed, reviewRound: 0, feedback: tryAgain ? task.feedback : answer })
  tell(`The human wants another attempt at ${task.key}. ${tryAgain ? `Latest review: ${task.feedback ?? ''}` : answer}`)
}
