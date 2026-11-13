/** Dawsha 1.8.7 style options. Each one works in both the Terminal and the Chat view of a pane. */

/** Classic: today's panes. Quiet: rounded panes, a calmer header and a one-line summary of the last reply. */
export type PaneStyle = 'classic' | 'quiet'
/** Top bar: tabs in the top bar. Sidebar: New session, Search and the tabs live in the sidebar, no top bar. */
export type FrameStyle = 'topbar' | 'sidebar'
/** Cool: the theme's blue greys. Warm: neutral greys, the theme's accent kept. */
export type Tone = 'cool' | 'warm'

export interface AppearanceSettings {
  panes: PaneStyle
  frame: FrameStyle
  tone: Tone
}

export const DEFAULT_APPEARANCE: AppearanceSettings = { panes: 'classic', frame: 'topbar', tone: 'cool' }

/** "Desktop app style" in Settings: all three new options at once. */
export const DESKTOP_APP_STYLE: AppearanceSettings = { panes: 'quiet', frame: 'sidebar', tone: 'warm' }

export const PANE_STYLE_LABELS: Record<PaneStyle, string> = { classic: 'Classic', quiet: 'Quiet' }
export const FRAME_STYLE_LABELS: Record<FrameStyle, string> = { topbar: 'Top bar', sidebar: 'Sidebar' }
export const TONE_LABELS: Record<Tone, string> = { cool: 'Cool', warm: 'Warm' }

const isPaneStyle = (value: unknown): value is PaneStyle => value === 'classic' || value === 'quiet'
const isFrameStyle = (value: unknown): value is FrameStyle => value === 'topbar' || value === 'sidebar'
const isTone = (value: unknown): value is Tone => value === 'cool' || value === 'warm'

export function sanitizeAppearance(value: unknown): AppearanceSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    panes: isPaneStyle(raw.panes) ? raw.panes : DEFAULT_APPEARANCE.panes,
    frame: isFrameStyle(raw.frame) ? raw.frame : DEFAULT_APPEARANCE.frame,
    tone: isTone(raw.tone) ? raw.tone : DEFAULT_APPEARANCE.tone
  }
}

export const sameAppearance = (a: AppearanceSettings, b: AppearanceSettings): boolean => a.panes === b.panes && a.frame === b.frame && a.tone === b.tone

export const OPENING_LAYOUT_LABELS: Record<'grid' | 'board' | 'panel', string> = { grid: 'Grid', board: 'Board', panel: 'Side panel' }

export const isDesktopAppStyle = (appearance: AppearanceSettings): boolean =>
  appearance.panes === DESKTOP_APP_STYLE.panes && appearance.frame === DESKTOP_APP_STYLE.frame && appearance.tone === DESKTOP_APP_STYLE.tone

/** The always-on-top Mini window: where it sits, whether it is folded, and whether minimizing Dawsha opens it. */
export interface MiniWindowSettings {
  showOnMinimize: boolean
  folded: boolean
  bounds: { x: number; y: number; width: number; height: number } | null
}

export const DEFAULT_MINI_WINDOW: MiniWindowSettings = { showOnMinimize: false, folded: false, bounds: null }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function sanitizeMiniWindow(value: unknown): MiniWindowSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const b = typeof raw.bounds === 'object' && raw.bounds !== null ? (raw.bounds as Record<string, unknown>) : null
  const bounds = b && finite(b.x) && finite(b.y) && finite(b.width) && finite(b.height) && b.width > 0 && b.height > 0
    ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
    : null
  return { showOnMinimize: raw.showOnMinimize === true, folded: raw.folded === true, bounds }
}
