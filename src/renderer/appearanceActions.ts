import { DEFAULT_APPEARANCE, DESKTOP_APP_STYLE, type AppearanceSettings } from '../shared/appearance'
import type { SessionsLayout } from '../shared/board'
import { api } from './api'
import { toast } from './components/toast'
import { store } from './state'

/** Changes one or more appearance options. Panes and frame follow the class on the app root; the tone repaints the theme at once (the app shell notices the tone). */
export function setAppearance(patch: Partial<AppearanceSettings>): void {
  const appearance: AppearanceSettings = { ...store.state.settings.appearance, ...patch }
  store.set((state) => ({ ...state, settings: { ...state.settings, appearance } }))
  api.updateSettings({ appearance }).catch((error: unknown) => toast((error as Error).message || 'Could not save settings.'))
}

export const useDesktopAppStyle = (): void => setAppearance({ ...DESKTOP_APP_STYLE })

export const backToClassic = (): void => setAppearance({ ...DEFAULT_APPEARANCE })

/** The layout Dawsha opens in. Unlike the View menu it does not switch pages. */
export function setOpeningLayout(sessionsLayout: SessionsLayout): void {
  store.set((state) => ({ ...state, settings: { ...state.settings, sessionsLayout } }))
  api.updateSettings({ sessionsLayout }).catch((error: unknown) => toast((error as Error).message || 'Could not save settings.'))
}
