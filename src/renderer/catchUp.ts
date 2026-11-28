import { AWAY_MIN_MS, catchUpHeadline, catchUpRows, catchUpWanted, limitSentence, type AwayChange, type CatchUpSession } from '../shared/away'
import { prLine } from '../shared/prWatch'
import { api } from './api'
import { openCatchUp } from './components/catchUpCard'
import { derivePanes } from './derive'
import { inboxItems } from './inbox'
import { prStateOf } from './prWatch'
import { store } from './state'

const WATCH_MS = 4000

interface Tracker {
  since: number
  limit: number | null
  worked: Set<string>
}

let tracker: Tracker | null = null
let watchTimer = 0

function fiveHourPercent(): number | null {
  const readings = derivePanes(store.state).flatMap((view) => view.info.limits.filter((window) => window.key === 'five_hour').map((window) => window.percent))
  return readings.length > 0 ? Math.max(...readings) : null
}

function watch(): void {
  if (!tracker) return
  for (const view of derivePanes(store.state)) if (view.status === 'busy') tracker.worked.add(view.pane.id)
}

function sessionsNow(worked: ReadonlySet<string>): CatchUpSession[] {
  const state = store.state
  const inbox = new Map(inboxItems(state).map((item) => [item.paneId, item]))
  return derivePanes(state).filter((view) => !view.snoozed && view.agent !== 'shell').map((view): CatchUpSession => {
    const item = inbox.get(view.pane.id)
    const pr = prStateOf(view.pane.id)
    return {
      paneId: view.pane.id, name: view.title, state: item?.state ?? 'idle', unread: view.unread, since: item?.since ?? state.now,
      line: item?.line ?? '', worked: worked.has(view.pane.id), changed: view.info.changes?.files ?? null,
      ciFailed: pr?.phase === 'failed' ? prLine(pr) : ''
    }
  })
}

/** Builds the card for an absence, or null when it was short, the card is off or nothing happened. */
export function catchUpFor(since: number, now: number, before: Tracker): { headline: string; rows: ReturnType<typeof catchUpRows> } | null {
  const awayMs = now - since
  const rows = catchUpRows(sessionsNow(before.worked), now)
  if (!catchUpWanted(awayMs, store.state.settings.catchUp, rows)) return null
  return { headline: catchUpHeadline(awayMs, before.worked.size, limitSentence(before.limit, fiveHourPercent())), rows }
}

function onAway(change: AwayChange): void {
  // The card is opt-in; with it off there is nothing to track or build, so leaving and coming back costs nothing.
  if (!store.state.settings.catchUp) {
    window.clearInterval(watchTimer)
    tracker = null
    return
  }
  if (change.away) {
    tracker = { since: change.since, limit: fiveHourPercent(), worked: new Set() }
    window.clearInterval(watchTimer)
    watchTimer = window.setInterval(watch, WATCH_MS)
    watch()
    return
  }
  window.clearInterval(watchTimer)
  const before = tracker
  tracker = null
  if (!before || Date.now() - change.since < AWAY_MIN_MS) return
  watch()
  const card = catchUpFor(change.since, Date.now(), before)
  if (card) openCatchUp(card.headline, card.rows)
}

/** Remembers how things stood when the owner left, and shows what changed when they come back after 20 minutes or more. */
export function installCatchUp(): void {
  api.onAway(onAway)
}
