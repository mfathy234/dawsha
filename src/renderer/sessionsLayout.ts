import type { SessionsLayout } from '../shared/board'
import { api } from './api'
import { toast } from './components/toast'
import { store } from './state'

export function setSessionsLayout(layout: SessionsLayout): void {
  store.set((state) => ({
    ...state,
    view: 'grid',
    boardPeekId: layout === 'board' ? state.boardPeekId : null,
    settings: { ...state.settings, sessionsLayout: layout }
  }))
  api.updateSettings({ sessionsLayout: layout }).catch((error: unknown) => toast((error as Error).message || 'Could not save settings.'))
}

export function toggleSessionsLayout(): void {
  setSessionsLayout(store.state.settings.sessionsLayout === 'board' ? 'grid' : 'board')
}

export const boardShowing = (state = store.state): boolean => state.view === 'grid' && state.settings.sessionsLayout === 'board'

/** Actions that open a pane in the grid (focus, maximize, timeline) leave the board first. */
export function leaveBoard(): void {
  if (store.state.settings.sessionsLayout === 'board') setSessionsLayout('grid')
}
