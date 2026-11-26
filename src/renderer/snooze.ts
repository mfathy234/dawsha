import { shouldWake } from '../shared/sessionCare'
import { prStateOf } from './prWatch'
import { derivePanes } from './derive'
import { toast } from './components/toast'
import { store } from './state'
import { updateCareMany } from './sessionCare'

const TICK_MS = 2000

function tick(): void {
  const state = store.state
  const wake = new Map<string, { snooze: undefined }>()
  const titles: string[] = []
  for (const view of derivePanes(state)) {
    const snooze = view.pane.care?.snooze
    if (!snooze) continue
    const paneId = view.pane.id
    const needs = state.attention[paneId] === 'needs' || state.waiting[paneId] === true || view.fileWaiting
    const pr = prStateOf(paneId)
    const checksPending = pr ? pr.pending > 0 || pr.phase === 'running' : null
    const lostPr = snooze.kind === 'checks' && pr === null
    if (lostPr || shouldWake(snooze, { now: Date.now(), needs, checksPending })) {
      wake.set(paneId, { snooze: undefined })
      titles.push(view.title)
    }
  }
  if (wake.size === 0) return
  updateCareMany(wake)
  toast(titles.length === 1 ? `${titles[0]} is back.` : `${titles.length} snoozed sessions are back.`, 'info')
}

/** Brings snoozed sessions back when their time or condition comes, and at once when one needs the owner. */
export function installSnooze(): void {
  window.setInterval(tick, TICK_MS)
}
