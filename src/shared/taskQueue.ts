export type QueueTaskState = 'queued' | 'running' | 'done' | 'failed'
export interface QueueTask { id: string; state: QueueTaskState }

export function availableQueueTasks<T extends QueueTask>(tasks: readonly T[], limit: number): T[] {
  const slots = Math.max(0, Math.floor(limit) - tasks.filter((task) => task.state === 'running').length)
  return tasks.filter((task) => task.state === 'queued').slice(0, slots)
}

export function transitionQueueTask<T extends QueueTask>(tasks: readonly T[], id: string, state: QueueTaskState): T[] {
  return tasks.map((task) => task.id === id ? { ...task, state } : task)
}

/** Moves a task one place up (-1) or down (1); returns an equal copy when it cannot move. */
export function moveQueueTask<T extends { id: string }>(tasks: readonly T[], id: string, delta: -1 | 1): T[] {
  const from = tasks.findIndex((task) => task.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= tasks.length) return [...tasks]
  const next = [...tasks]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/** What the runner remembers about one running task between checks. */
export interface QueueTracker { sawBusy: boolean; idleChecks: number }
export type PaneActivity = 'busy' | 'idle' | 'exited' | 'gone'
export interface TrackedStep { tracker: QueueTracker; outcome: 'running' | 'done' | 'failed' }

/** Idle checks in a row, after the agent worked, that count as finished. */
const SETTLED_IDLE_CHECKS = 2

export const startTracker = (): QueueTracker => ({ sawBusy: false, idleChecks: 0 })

/** Advances one running task: done after work then a settled idle, or on a clean exit; failed on an error exit or a closed pane. */
export function nextTrackedState(tracker: QueueTracker, activity: PaneActivity, exitCode?: number): TrackedStep {
  if (activity === 'gone') return { tracker, outcome: 'failed' }
  if (activity === 'exited') return { tracker, outcome: exitCode === 0 || exitCode === undefined ? 'done' : 'failed' }
  if (activity === 'busy') return { tracker: { sawBusy: true, idleChecks: 0 }, outcome: 'running' }
  if (!tracker.sawBusy) return { tracker, outcome: 'running' }
  const idleChecks = tracker.idleChecks + 1
  return { tracker: { ...tracker, idleChecks }, outcome: idleChecks >= SETTLED_IDLE_CHECKS ? 'done' : 'running' }
}
