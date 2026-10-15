import type { TimelineRequest } from '../shared/timeline'
import { paneById, folderOfPane, store } from './state'
import { derivePanes } from './derive'
import { sessionIdOf } from './transcriptActions'

export function openTimeline(paneId: string): void {
  if (!paneById(store.state, paneId)) return
  store.set((s) => ({
    ...s,
    focusedId: paneId,
    view: 'grid',
    maximizedId: paneId,
    detailsPaneId: null,
    timelinePaneId: paneId,
    sidebarOverride: null
  }))
}

export function closeTimeline(): void {
  if (store.state.timelinePaneId) store.set((s) => ({ ...s, timelinePaneId: null }))
}

export function toggleTimeline(paneId: string): void {
  const open = store.state.timelinePaneId === paneId && store.state.maximizedId === paneId
  if (open) closeTimeline()
  else openTimeline(paneId)
}

/** Where to find a pane's agent session log, or null for a pane with no agent. */
export function timelineRequest(paneId: string): TimelineRequest | null {
  const state = store.state
  const pane = paneById(state, paneId)
  const view = derivePanes(state).find((v) => v.pane.id === paneId)
  const tab = pane?.tabs.find((t) => t.id === view?.primaryTabId)
  const folder = pane ? folderOfPane(state, pane) : null
  if (!pane || !tab || !folder || tab.agent === 'shell') return null
  return { agent: tab.agent, sessionId: sessionIdOf(tab), folder }
}
