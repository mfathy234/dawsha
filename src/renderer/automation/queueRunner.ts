import { availableQueueTasks, nextTrackedState, startTracker, type PaneActivity, type QueueTracker } from '../../shared/taskQueue'
import type { QueuedPrompt } from '../../shared/types'
import { toast } from '../components/toast'
import { derivePanes } from '../derive'
import { store } from '../state'
import { patchQueueTask } from './settings'
import { startPromptRun } from './startRun'

const POLL_MS = 2000
const active = new Set<string>()
const trackers = new Map<string, QueueTracker>()
let busy = false

export const isQueueActive = (projectId: string): boolean => active.has(projectId)

function activityOf(task: QueuedPrompt): { activity: PaneActivity; exitCode?: number } {
  const view = derivePanes(store.state).find((item) => item.pane.id === task.paneId)
  if (!view) return { activity: 'gone' }
  const exitCode = view.pane.tabs.find((tab) => tab.id === view.primaryTabId)?.exitCode
  // A pane waiting for the user to answer is not finished.
  return { activity: view.status === 'idle' && view.attention === 'needs' ? 'busy' : view.status, exitCode }
}

function reconcile(): void {
  const running = store.state.settings.queuedPrompts.filter((item) => item.state === 'running')
  for (const task of running) {
    const { activity, exitCode } = activityOf(task)
    const step = nextTrackedState(trackers.get(task.id) ?? startTracker(), activity, exitCode)
    trackers.set(task.id, step.tracker)
    if (step.outcome === 'running') continue
    trackers.delete(task.id)
    const error = activity === 'gone' ? 'The session was closed before it finished.' : 'The agent exited with an error.'
    patchQueueTask(task.id, step.outcome === 'done' ? { state: 'done' } : { state: 'failed', error })
  }
}

async function launchTask(task: QueuedPrompt): Promise<void> {
  const agent = task.agent ?? store.state.settings.queueAgent
  patchQueueTask(task.id, { state: 'running', error: undefined })
  const result = await startPromptRun({ projectId: task.projectId, agent, prompt: task.prompt, worktree: true })
  if (result.ok) patchQueueTask(task.id, { paneId: result.paneId })
  else patchQueueTask(task.id, { state: 'failed', error: result.error })
}

async function startNext(): Promise<void> {
  for (const projectId of [...active]) {
    const { queuedPrompts, queueConcurrency } = store.state.settings
    const own = queuedPrompts.filter((task) => task.projectId === projectId)
    if (!own.some((task) => task.state === 'queued' || task.state === 'running')) {
      active.delete(projectId)
      toast('The queue has finished.', 'info')
      continue
    }
    for (const task of availableQueueTasks(own, queueConcurrency)) await launchTask(task)
  }
}

async function pump(): Promise<void> {
  if (busy) return
  busy = true
  try {
    reconcile()
    await startNext()
  } finally {
    busy = false
  }
}

export function startQueue(projectId: string): void {
  active.add(projectId)
  void pump()
}

/** Stops starting new tasks; running sessions are left alone. */
export function stopQueue(projectId: string): void {
  active.delete(projectId)
  store.set((state) => ({ ...state }))
}

/** Follows running tasks to their end and starts queued ones for every project whose queue is running. */
export function installQueueRunner(): void {
  window.setInterval(() => void pump(), POLL_MS)
}
