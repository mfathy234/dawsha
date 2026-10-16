import type { OrchTask, PauseStatus, TaskStatus } from './types'

// Pausing (blocked, waiting_on_human) is handled by pauseTask/resumeTask, not this table.
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['assigned', 'in_progress', 'cancelled'],
  assigned: ['in_progress', 'todo', 'stalled', 'cancelled'],
  in_progress: ['done_pending_review', 'approved', 'stalled', 'cancelled'],
  done_pending_review: ['in_review', 'in_progress', 'approved', 'cancelled'],
  in_review: ['approved', 'in_progress', 'cancelled'],
  stalled: ['in_progress', 'todo', 'cancelled'],
  blocked: ['cancelled'],
  waiting_on_human: ['cancelled'],
  approved: [],
  cancelled: []
}

export const isFinal = (status: TaskStatus): boolean => status === 'approved' || status === 'cancelled'

export const isPaused = (status: TaskStatus): status is PauseStatus => status === 'blocked' || status === 'waiting_on_human'

export const canMove = (from: TaskStatus, to: TaskStatus): boolean => TRANSITIONS[from].includes(to)

export function moveTask(task: OrchTask, to: TaskStatus, now: number): OrchTask {
  if (!canMove(task.status, to)) throw new Error(`Task ${task.key} cannot move from ${task.status} to ${to}.`)
  return { ...task, status: to, updatedAt: now }
}

export function pauseTask(task: OrchTask, to: PauseStatus, now: number): OrchTask {
  if (isFinal(task.status)) throw new Error(`Task ${task.key} is ${task.status} and cannot be paused.`)
  if (isPaused(task.status)) return { ...task, status: to, updatedAt: now }
  return { ...task, status: to, pausedFrom: task.status, updatedAt: now }
}

export function resumeTask(task: OrchTask, now: number): OrchTask {
  if (!isPaused(task.status) || !task.pausedFrom) throw new Error(`Task ${task.key} is not paused.`)
  return { ...task, status: task.pausedFrom, pausedFrom: null, updatedAt: now }
}
