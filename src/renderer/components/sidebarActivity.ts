import { lastOutputAt } from '../ptyActivity'
import type { PaneView } from '../derive'
import type { AppState } from '../state'

export const SORT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16M3 17l3 3 3-3M13 6h8M13 12h6M13 18h4"/></svg>'

const FRESH_BUCKET_MS = 5 * 60_000

/** When a session last did something: its latest terminal output, else when it started. */
export function viewActivity(view: PaneView): number {
  const tab = view.pane.tabs.find((item) => item.id === view.primaryTabId)
  return lastOutputAt(view.primaryTabId) ?? tab?.startedAt ?? 0
}

/** Latest activity per project in coarse buckets, so the Recent order moves when work moves, not on every line of output. */
export function projectActivity(state: AppState, views: PaneView[]): Record<string, number> {
  const activity: Record<string, number> = {}
  const note = (projectId: string, at: number): void => {
    const bucket = Math.floor(at / FRESH_BUCKET_MS) * FRESH_BUCKET_MS
    if (bucket > (activity[projectId] ?? 0)) activity[projectId] = bucket
  }
  for (const view of views) note(view.pane.projectId, viewActivity(view))
  for (const session of state.settings.keptSessions) note(session.projectId, session.closedAt)
  return activity
}
