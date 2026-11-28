import { api } from './api'
import { slowestPhases } from './slowPhases'
import { store } from './state'

const SLOW_MS = 500

/** Tells main when a task on the page ran for over half a second; main writes the line to the slow log, at most once per 10 seconds, and for a task of over a second adds the functions that ran. */
export function installSlowReport(): void {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return
  new PerformanceObserver((list) => {
    const worst = list.getEntries().reduce((a, b) => (b.duration > a.duration ? b : a))
    if (worst.duration < SLOW_MS) return
    const { view, panes, maximizedId } = store.state
    const attribution = (worst as PerformanceEntry & { attribution?: { containerType?: string; name?: string }[] }).attribution?.[0]
    api.reportSlow({
      ms: worst.duration,
      view,
      detail: `${panes.length} panes${maximizedId ? ', one maximized' : ''}; ${attribution?.containerType ?? 'window'} ${attribution?.name ?? ''}`.trim(),
      phases: slowestPhases(worst.startTime + worst.duration)
    })
  }).observe({ type: 'longtask', buffered: false })
}
