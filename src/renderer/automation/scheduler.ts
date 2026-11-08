import { dueSchedules, recordRun } from '../../shared/schedules'
import type { ScheduledRun } from '../../shared/types'
import { toast } from '../components/toast'
import { store } from '../state'
import { updateSchedules } from './settings'
import { startPromptRun } from './startRun'

const CHECK_MS = 60_000
let checking = false

async function runOne(schedule: ScheduledRun): Promise<void> {
  const result = await startPromptRun({ projectId: schedule.projectId, agent: schedule.agent, prompt: schedule.prompt, worktree: schedule.worktree })
  const at = Date.now()
  const record = result.ok ? { at, status: 'started' as const, paneId: result.paneId } : { at, status: 'failed' as const, error: result.error }
  updateSchedules((all) => all.map((item) => (item.id === schedule.id ? recordRun(item, record) : item)))
  if (!result.ok) toast(`The scheduled run "${schedule.name}" did not start. ${result.error}`)
}

/** Starts what is due, then stamps every schedule as checked so no run is repeated or caught up twice. */
export async function checkSchedules(now = Date.now()): Promise<void> {
  if (checking) return
  checking = true
  try {
    const all = store.state.settings.scheduledRuns
    if (all.length === 0) return
    const due = dueSchedules(all, now)
    updateSchedules((list) => list.map((item) => ({ ...item, lastCheckedAt: now })))
    for (const { schedule } of due) await runOne(schedule)
  } finally {
    checking = false
  }
}

/** Checks once at startup (which catches up on runs missed within the last 12 hours) and then every minute. */
export function installScheduler(): void {
  void checkSchedules()
  window.setInterval(() => void checkSchedules(), CHECK_MS)
}
