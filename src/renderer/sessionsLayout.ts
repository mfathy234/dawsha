import type { GridStyle } from '../shared/gridStyle'
import type { SessionsLayout } from '../shared/board'
import { api } from './api'
import { toast } from './components/toast'
import { panelDockedOn, type SidePanelSettings } from '../shared/sidePanel'
import { store } from './state'

export function setSessionsLayout(layout: SessionsLayout): void {
  store.set((state) => ({
    ...state,
    view: 'grid',
    // The Side panel shows the focused session on its own, so it keeps a maximized pane; the other layouts start from the grid.
    maximizedId: layout === 'panel' ? (state.focusedId ?? state.panes[0]?.id ?? null) : state.settings.sessionsLayout === 'panel' ? null : state.maximizedId,
    boardPeekId: layout === 'board' ? state.boardPeekId : null,
    settings: { ...state.settings, sessionsLayout: layout }
  }))
  api.updateSettings({ sessionsLayout: layout }).catch((error: unknown) => toast((error as Error).message || 'Could not save settings.'))
}

export function toggleSessionsLayout(): void {
  setSessionsLayout(store.state.settings.sessionsLayout === 'board' ? 'grid' : 'board')
}

/** Grid, Board or Side panel, in the order the switch lists them. */
export const SESSION_LAYOUTS: readonly { id: SessionsLayout; label: string; title: string }[] = [
  { id: 'grid', label: 'Grid', title: 'Show sessions as a grid' },
  { id: 'board', label: 'Board', title: 'Show sessions as a board' },
  { id: 'panel', label: 'Side panel', title: 'Show one session with its changes, plan and checks beside it' }
]

export const panelShowing = (state = store.state): boolean => state.view === 'grid' && state.settings.sessionsLayout === 'panel'

export const boardShowing = (state = store.state): boolean => state.view === 'grid' && state.settings.sessionsLayout === 'board'

/** Actions that open a pane in the grid (focus, maximize, timeline) leave the board first. */
export function leaveBoard(): void {
  if (store.state.settings.sessionsLayout === 'board') setSessionsLayout('grid')
}

/** Calm focus or mission control. Used by the Layouts popover, the palette and the Settings page. */
export function setGridStyle(gridStyle: GridStyle): void {
  if (store.state.settings.gridStyle === gridStyle) return
  store.set((state) => ({ ...state, settings: { ...state.settings, gridStyle } }))
  api.updateSettings({ gridStyle }).catch((error: unknown) => toast((error as Error).message || 'Could not save settings.'))
}

export const panelDocked = (state = store.state): boolean =>
  panelDockedOn({ view: state.view, sessionsLayout: state.settings.sessionsLayout, frame: state.settings.appearance.frame, docked: state.settings.sidePanel.docked })

/** The toolbar toggle and Ctrl+Alt+B in Desktop app style: dock the Session panel beside the sessions, or take it away. */
export function toggleDockedPanel(): void {
  const sidePanel: SidePanelSettings = { ...store.state.settings.sidePanel, docked: !store.state.settings.sidePanel.docked }
  store.set((state) => ({ ...state, settings: { ...state.settings, sidePanel } }))
  api.updateSettings({ sidePanel }).catch((error: unknown) => toast((error as Error).message || 'Could not save settings.'))
}
