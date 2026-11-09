import type { QueuedPrompt, ScheduledRun, Settings } from '../../shared/types'
import { saveSettings } from '../actions'
import { store } from '../state'

type AutomationPatch = Partial<Pick<Settings, 'scheduledRuns' | 'queuedPrompts' | 'queueConcurrency' | 'queueAgent'>>

/** Shows a change at once and saves it. */
export function saveAutomation(patch: AutomationPatch): void {
  store.set((state) => ({ ...state, settings: { ...state.settings, ...patch } }))
  void saveSettings(patch)
}

/** Applies a change to the schedules as they are right now, so work that finished while awaiting is not overwritten. */
export function updateSchedules(change: (schedules: readonly ScheduledRun[]) => ScheduledRun[]): void {
  saveAutomation({ scheduledRuns: change(store.state.settings.scheduledRuns) })
}

export function updateQueue(change: (tasks: readonly QueuedPrompt[]) => QueuedPrompt[]): void {
  saveAutomation({ queuedPrompts: change(store.state.settings.queuedPrompts) })
}

export function patchQueueTask(id: string, patch: Partial<QueuedPrompt>): void {
  updateQueue((tasks) => tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)))
}
