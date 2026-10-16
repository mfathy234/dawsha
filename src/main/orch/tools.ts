import { REVIEWER_FOR } from '../../shared/orch/roles'
import { isFinal, pauseTask } from '../../shared/orch/taskMachine'
import type { EstimateSize, OrchAgent, OrchRole, OrchTask, TaskStatus } from '../../shared/orch/types'
import {
  IN_REVIEW,
  MAX_OPEN_DECISIONS_PER_AGENT,
  MAX_REVIEW_ROUNDS,
  MAX_TASKS_PER_RUN,
  OrchToolError,
  RESERVED_NOTE_PREFIX,
  statusText,
  str,
  strList,
  type OrchContext
} from './context'
import { reviewSpec } from './text'

type Args = Record<string, unknown>
export type ToolHandler = (me: OrchAgent, args: Args) => unknown

/** What each MCP tool does. Permissions and argument checks happen before these run. */
export function createToolHandlers(ctx: OrchContext): Record<string, ToolHandler> {
  return {
    whoami: (me) => whoami(ctx, me),
    list_agents: (me) => listAgents(ctx, me),
    create_task: (me, args) => createTask(ctx, me, args),
    cancel_run: (me, args) => cancelRun(ctx, me, args),
    set_estimate: (me, args) => setEstimate(ctx, me, args),
    list_tasks: (me, args) => ctx.store.listTasks({ runId: me.runId, status: (str(args.status) || undefined) as TaskStatus | undefined }),
    get_my_task: (me) => getMyTask(ctx, me),
    update_task: (me, args) => updateTask(ctx, me, args),
    complete_task: (me, args) => completeTask(ctx, me, args),
    block_task: (me, args) => blockTask(ctx, me, args),
    submit_review: (me, args) => submitReview(ctx, me, args),
    send_message: (me, args) => sendMessage(ctx, me, args),
    fetch_inbox: (me) => fetchInbox(ctx, me),
    put_note: (me, args) => putAgentNote(ctx, me, str(args.key), str(args.text)),
    get_notes: (me) => ctx.store.listNotes(me.runId).map(({ key, text, author }) => ({ key, text, author })),
    ask_human: (me, args) => askHuman(ctx, me, args)
  }
}

function whoami(ctx: OrchContext, me: OrchAgent): unknown {
  const run = ctx.store.getRun(me.runId)
  const task = ctx.activeTaskOf(me)
  return {
    agent_id: me.id, role: me.role, model: me.model, run_id: me.runId, run_title: run?.title ?? '',
    // The title is shortened from the story; the story is the full request.
    story: run?.story ?? '', project_path: run?.projectPath ?? '', task: task?.key ?? null
  }
}

function listAgents(ctx: OrchContext, me: OrchAgent): unknown {
  return ctx.store.listAgents(me.runId).filter((agent) => !agent.retiredAt).map((agent) => ({
    id: agent.id,
    role: agent.role,
    runner: agent.runner,
    model: agent.model,
    task: ctx.activeTaskOf(agent)?.key ?? null
  }))
}

function createTask(ctx: OrchContext, me: OrchAgent, args: Args): OrchTask {
  if (ctx.store.nextTaskNumber(me.runId) > MAX_TASKS_PER_RUN) {
    throw new OrchToolError(`This run already has ${MAX_TASKS_PER_RUN} tasks. Ask the human before adding more.`)
  }
  const self = args.self === true
  const role = (self ? 'lead' : str(args.role)) as OrchRole
  // Building waits for the spec: the lead's own build task too, not only other agents' (held by the dispatcher).
  const specPending = ctx.store.listTasks({ runId: me.runId }).some((t) => t.role === 'spec-writer' && !isFinal(t.status))
  if (self && specPending) {
    throw new OrchToolError('A spec is being written. Wait until you are told it is approved, then take the build task.')
  }
  if (role === 'code-reviewer' || role === 'ux-reviewer') {
    throw new OrchToolError('Reviews are not separate tasks. Set review: true on the task whose work should be reviewed.')
  }
  const dependsOn = strList(args.depends_on)
  for (const key of dependsOn) ctx.task(key, me.runId)
  const task = ctx.newTask(me.runId, {
    title: str(args.title),
    spec: str(args.spec),
    role,
    dependsOn,
    acceptance: strList(args.acceptance),
    review: args.review === true
  })
  if (!self) {
    ctx.log(me.runId, 'task', `${task.key} created for ${task.role}: ${task.title}`, task.id)
    return task
  }
  // The lead does it itself, in its own folder on the run branch: no other agent starts for it.
  const mine = ctx.save({ ...ctx.move(task, 'in_progress'), assignee: me.id })
  ctx.store.putAgent({ ...me, taskId: mine.id })
  ctx.log(me.runId, 'task', `${task.key} taken by the lead: ${task.title}`, task.id)
  return mine
}

function setEstimate(ctx: OrchContext, me: OrchAgent, args: Args): unknown {
  const run = ctx.store.getRun(me.runId)
  if (!run) throw new OrchToolError('This run no longer exists.')
  const estimate = { size: str(args.size) as EstimateSize, reason: str(args.reason) }
  ctx.store.putRun({ ...run, estimate })
  const team = estimate.size === 'large' ? 'a team' : 'the lead alone'
  ctx.log(me.runId, 'plan', `Estimate: ${estimate.size}, done by ${team}. ${estimate.reason}`, null)
  return { ok: true, next: estimate.size === 'large' ? 'Create tasks for the team.' : 'Create one task with self: true and do it yourself.' }
}

function cancelRun(ctx: OrchContext, me: OrchAgent, args: Args): unknown {
  ctx.finishRun(me.runId, 'cancelled', `The lead cancelled the run: ${str(args.reason)}`)
  return { status: 'cancelled' }
}

function getMyTask(ctx: OrchContext, me: OrchAgent): unknown {
  const current = ctx.activeTaskOf(me)
  if (current) return current.status === 'assigned' ? ctx.move(current, 'in_progress') : current
  const waiting = ctx.store.listTasks({ runId: me.runId }).find((task) => task.assignee === me.id && IN_REVIEW.includes(task.status))
  if (waiting) return { task: null, message: `${waiting.key} is in review. Wait for the result in fetch_inbox before taking new work.` }
  ctx.cancelStaleReviews(me.runId)
  const next = ctx.nextReadyTask(me)
  if (!next) return { task: null, message: 'No task is ready for your role right now.' }
  const claimed = ctx.save({ ...ctx.move(next, 'in_progress'), assignee: me.id })
  ctx.store.putAgent({ ...me, taskId: claimed.id })
  ctx.log(me.runId, 'task', `${me.role} started ${claimed.key}`, claimed.id)
  if (claimed.reviewOf) {
    const original = ctx.task(claimed.reviewOf, me.runId)
    if (original.status === 'done_pending_review') ctx.move(original, 'in_review')
  }
  return claimed
}

function updateTask(ctx: OrchContext, me: OrchAgent, args: Args): unknown {
  const task = ctx.requireWorkingTask(me)
  ctx.log(me.runId, 'progress', `${task.key}: ${str(args.progress)}`, task.id)
  return { ok: true }
}

function completeTask(ctx: OrchContext, me: OrchAgent, args: Args): unknown {
  const task = ctx.requireWorkingTask(me)
  if (task.reviewOf) throw new OrchToolError('This is a review task: use submit_review instead.')
  const tests = str(args.tests)
  const done: OrchTask = {
    ...task,
    summary: str(args.summary) + (tests ? `\nTests: ${tests}` : ''),
    files: strList(args.files),
    branch: str(args.branch) || task.branch,
    feedback: null
  }
  // Reviews only happen when the lead asked for one on this task.
  const reviewer = task.review ? REVIEWER_FOR[task.role] ?? 'code-reviewer' : undefined
  if (reviewer) return sendToReview(ctx, me, done, reviewer)
  if (task.role === 'spec-writer') return sendSpecToHuman(ctx, me, done)
  ctx.move(done, 'approved')
  ctx.log(me.runId, 'task', `${task.key} done`, task.id)
  return { status: 'approved' }
}

function sendToReview(ctx: OrchContext, me: OrchAgent, done: OrchTask, reviewer: OrchRole): unknown {
  ctx.move(done, 'done_pending_review')
  const review = ctx.newTask(me.runId, {
    title: `Review ${done.key}: ${done.title}`,
    spec: reviewSpec(done),
    role: reviewer,
    dependsOn: [],
    acceptance: done.acceptance,
    reviewOf: done.key
  })
  ctx.log(me.runId, 'task', `${done.key} finished, sent to review (${review.key})`, done.id)
  return { status: 'done_pending_review', review_task: review.key }
}

function sendSpecToHuman(ctx: OrchContext, me: OrchAgent, done: OrchTask): unknown {
  const run = ctx.store.getRun(me.runId)
  if (run?.specApproval === false) {
    ctx.move(done, 'approved')
    ctx.log(me.runId, 'task', `${done.key} spec approved (this plan has no spec stop)`, done.id)
    return { status: 'approved' }
  }
  ctx.move(done, 'done_pending_review')
  ctx.newDecision(me, 'spec-approval', {
    question: `Approve the spec for "${run?.title ?? done.title}"?`,
    options: ['Approve', 'Request changes'],
    recommended: null,
    context: [done.summary, ...done.files].filter(Boolean).join('\n'),
    taskId: done.id
  })
  ctx.log(me.runId, 'task', `${done.key} spec ready for your approval`, done.id)
  return { status: 'done_pending_review', message: 'The human will review the spec. Check fetch_inbox for their answer.' }
}

function blockTask(ctx: OrchContext, me: OrchAgent, args: Args): unknown {
  const task = ctx.requireWorkingTask(me)
  const reason = str(args.reason)
  ctx.save(pauseTask({ ...task, feedback: reason }, 'blocked', ctx.now()))
  const decision = ctx.newDecision(me, 'question', {
    question: `${task.key} is blocked: ${reason}`,
    options: ['Unblocked, continue', 'Cancel task'],
    recommended: null,
    context: task.spec,
    taskId: task.id
  })
  ctx.log(me.runId, 'task', `${task.key} blocked: ${reason}`, task.id)
  return { status: 'blocked', decision_id: decision.id }
}

function submitReview(ctx: OrchContext, me: OrchAgent, args: Args): unknown {
  const review = ctx.requireWorkingTask(me)
  if (!review.reviewOf) throw new OrchToolError('Your current task is not a review.')
  const comments = str(args.comments)
  const original = ctx.task(review.reviewOf, me.runId)
  if (!IN_REVIEW.includes(original.status)) {
    ctx.move(review, 'cancelled')
    return { status: 'cancelled', message: `${original.key} is ${statusText(original.status)}; this review is no longer needed.` }
  }
  ctx.save({ ...ctx.move(review, 'approved'), summary: comments })
  if (args.verdict === 'approve') {
    ctx.move(original, 'approved')
    ctx.message(me.runId, me.id, original.assignee, original.id, `Review of ${original.key} approved: ${comments}`)
    ctx.log(me.runId, 'review', `${original.key} approved by ${me.role}`, original.id)
    return { status: 'approved' }
  }
  const round = original.reviewRound + 1
  if (round >= MAX_REVIEW_ROUNDS) return escalate(ctx, me, original, round, comments)
  ctx.save({ ...ctx.move(original, 'in_progress'), reviewRound: round, feedback: comments })
  ctx.message(me.runId, me.id, original.assignee, original.id, `Review of ${original.key} (round ${round}): changes requested.\n${comments}`)
  ctx.log(me.runId, 'review', `${original.key} rejected (round ${round}): ${comments}`, original.id)
  return { status: 'changes_requested', round }
}

function escalate(ctx: OrchContext, me: OrchAgent, original: OrchTask, round: number, comments: string): unknown {
  ctx.save({ ...original, reviewRound: round, feedback: comments, status: 'waiting_on_human', pausedFrom: 'in_progress', updatedAt: ctx.now() })
  ctx.newDecision(ctx.store.getAgent(original.assignee ?? '') ?? me, 'escalation', {
    question: `${original.key} "${original.title}" was rejected ${round} times. Latest review: ${comments}`,
    options: ['Try again', 'Approve anyway', 'Cancel task'],
    recommended: null,
    context: original.summary ?? '',
    taskId: original.id
  })
  ctx.log(me.runId, 'review', `${original.key} rejected ${round} times, escalated to you`, original.id)
  return { status: 'escalated' }
}

function sendMessage(ctx: OrchContext, me: OrchAgent, args: Args): unknown {
  const to = str(args.to)
  const agents = ctx.store.listAgents(me.runId).filter((agent) => !agent.retiredAt && (agent.id === to || agent.role === to))
  if (agents.length === 0) throw new OrchToolError(`No agent or role called "${to}" in this run.`)
  const taskKey = str(args.task)
  const taskId = taskKey ? ctx.task(taskKey, me.runId).id : null
  for (const agent of agents) ctx.message(me.runId, me.id, agent.id, taskId, str(args.body))
  return { sent_to: agents.map((agent) => agent.id) }
}

function fetchInbox(ctx: OrchContext, me: OrchAgent): unknown {
  const now = ctx.now()
  return ctx.store.unreadFor(me.id).map((message) => {
    ctx.store.putMessage({ ...message, readAt: now })
    const task = message.taskId ? ctx.store.getTask(message.taskId) : undefined
    return { from: message.from, task: task?.key ?? null, body: message.body, at: message.createdAt }
  })
}

function putAgentNote(ctx: OrchContext, me: OrchAgent, key: string, text: string): unknown {
  if (key.startsWith(RESERVED_NOTE_PREFIX)) throw new OrchToolError(`Note keys starting with "${RESERVED_NOTE_PREFIX}" are reserved for the human's answers.`)
  const existing = ctx.store.listNotes(me.runId).find((note) => note.key === key)
  if (existing?.author === 'human') throw new OrchToolError(`The note "${key}" was written by the human and cannot be changed.`)
  return ctx.putNote(me.runId, key, text, me.id)
}

/** A spec writer asking the human to approve its spec: that is what complete_task does. */
const ASKS_APPROVAL = /approv/i

function askHuman(ctx: OrchContext, me: OrchAgent, args: Args): unknown {
  if (me.role === 'spec-writer' && ASKS_APPROVAL.test(str(args.question))) {
    throw new OrchToolError('Do not ask for approval with ask_human. Commit spec.md and the mockups in .dawsha/runs/<run id>/ and call complete_task: that sends the spec to the human to approve. Use ask_human only for open questions about the requirements.')
  }
  const task = ctx.activeTaskOf(me)
  const open = ctx.store.openDecisions().filter((d) => d.agentId === me.id)
  const pending = task ? open.find((d) => d.taskId === task.id) : undefined
  if (pending) return { decision_id: pending.id, status: 'waiting', message: 'You already asked the human about this task. Wait for the answer in fetch_inbox.' }
  if (open.length >= MAX_OPEN_DECISIONS_PER_AGENT) {
    throw new OrchToolError(`You have ${open.length} questions waiting for the human. Wait for answers before asking more.`)
  }
  const decision = ctx.newDecision(me, 'question', {
    question: str(args.question),
    options: strList(args.options),
    recommended: typeof args.recommended === 'number' ? args.recommended : null,
    context: str(args.context),
    taskId: task?.id ?? null,
    urgency: args.urgency === 'high' ? 'high' : 'normal'
  })
  if (task && !isFinal(task.status)) ctx.save(pauseTask(task, 'waiting_on_human', ctx.now()))
  ctx.log(me.runId, 'decision', `${me.role} asked you: ${decision.question}`, task?.id ?? null)
  return { decision_id: decision.id, status: 'waiting', message: 'Your task is paused until the human answers. The answer arrives in fetch_inbox.' }
}
