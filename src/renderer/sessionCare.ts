import { snoozeFor, withCare, type DoneRule, type SessionCare, type SnoozeChoice } from '../shared/sessionCare'
import { focusPane, persistWorkspace } from './actions'
import { acknowledgeAttention } from './attention'
import { derivePanes } from './derive'
import { toast } from './components/toast'
import { store, mapPane, paneById, type AppState } from './state'

type CarePatch = { [K in keyof SessionCare]?: SessionCare[K] | undefined }

export const careOf = (state: AppState, paneId: string): SessionCare | undefined => paneById(state, paneId)?.care

export const isUnread = (paneId: string): boolean => careOf(store.state, paneId)?.unread === true

export const isSnoozed = (paneId: string): boolean => careOf(store.state, paneId)?.snooze !== undefined

/** Changes one pane's care and saves it with the workspace. */
export function updateCare(paneId: string, patch: CarePatch): void {
  const pane = paneById(store.state, paneId)
  if (!pane) return
  const care = withCare(pane.care, patch)
  store.set((s) => mapPane(s, paneId, (p) => ({ ...p, care })))
  persistWorkspace()
}

/** Applies the same change to several panes at once, so one redraw and one save cover them all. */
export function updateCareMany(changes: ReadonlyMap<string, CarePatch>): void {
  if (changes.size === 0) return
  store.set((s) => ({ ...s, panes: s.panes.map((pane) => (changes.has(pane.id) ? { ...pane, care: withCare(pane.care, changes.get(pane.id) ?? {}) } : pane)) }))
  persistWorkspace()
}

export function markRead(paneId: string): void {
  acknowledgeAttention(paneId)
  if (isUnread(paneId)) updateCare(paneId, { unread: undefined })
}

export function setNote(paneId: string, text: string): void {
  const clean = text.replace(/\s+/g, ' ').trim()
  updateCare(paneId, { note: clean ? { text: clean, at: Date.now() } : undefined })
}

export function setRule(paneId: string, rule: DoneRule | null): void {
  updateCare(paneId, { rule: rule ?? undefined })
}

const titleOf = (paneId: string): string => derivePanes(store.state).find((view) => view.pane.id === paneId)?.title ?? 'The session'

/** Moves the focus off a pane that is about to leave the visible lists. */
function focusAway(paneId: string): void {
  const state = store.state
  if (state.focusedId !== paneId && state.maximizedId !== paneId) return
  const next = state.panes.find((pane) => pane.id !== paneId && pane.care?.snooze === undefined)
  if (next) focusPane(next.id)
}

export function snoozePane(paneId: string, choice: SnoozeChoice): void {
  const snooze = snoozeFor(choice, Date.now())
  updateCare(paneId, { snooze })
  focusAway(paneId)
  toast(`${titleOf(paneId)} snoozed: ${snooze.label.toLowerCase()}.`, 'info')
}

export function wakePane(paneId: string, quiet = false): void {
  if (!isSnoozed(paneId)) return
  updateCare(paneId, { snooze: undefined })
  if (!quiet) toast(`${titleOf(paneId)} is back.`, 'info')
}

export const snoozedViews = (state: AppState) => derivePanes(state).filter((view) => view.snoozed)
