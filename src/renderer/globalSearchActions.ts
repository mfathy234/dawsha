import type { SearchHit } from '../shared/timelineSearch'
import type { ResumeSession } from '../shared/types'
import { findOpenSession, focusOpenSession, resumeInNewPane } from './actions'
import { openTimelineWith } from './timelineActions'
import { paneById, store } from './state'

/** Opens a search result where the timeline's all-sessions search does: the session's own pane when it is open, else its log in the focused pane. */
export function openSessionHit(session: ResumeSession, hit: SearchHit | undefined, query: string): void {
  const target = hit ? { at: hit.at, kind: hit.kind, text: hit.text } : undefined
  const open = findOpenSession(store.state, session.agent, session.id)
  if (open) {
    focusOpenSession(open)
    openTimelineWith(open.paneId, { query, target })
    return
  }
  const state = store.state
  const pane = paneById(state, state.focusedId) ?? state.panes[0]
  if (pane) openTimelineWith(pane.id, { query, target, session })
  else void resumeInNewPane(session)
}
