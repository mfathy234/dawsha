import { clampFontSize, DEFAULT_FONT_SIZE } from '../shared/types'
import type { AppState } from './state'

/** The top-bar size buttons: the focused pane's size (or the first pane's, as the top bar shows) plus delta, applied to every pane and every project with an open pane. */
export function sharedZoomState(state: AppState, delta: number): AppState {
  const focused = state.panes.find((pane) => pane.id === state.focusedId) ?? state.panes[0]
  const fontSize = clampFontSize((focused?.fontSize ?? DEFAULT_FONT_SIZE) + delta)
  const openProjects = new Set(state.panes.map((pane) => pane.projectId))
  return {
    ...state,
    panes: state.panes.map((pane) => ({ ...pane, fontSize })),
    settings: {
      ...state.settings,
      projects: state.settings.projects.map((project) => (openProjects.has(project.id) ? { ...project, fontSize } : project))
    }
  }
}
