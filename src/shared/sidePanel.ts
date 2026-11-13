/** The Side panel layout: one session beside a panel of Changes, Plan and Checks. */
export type SidePanelTab = 'changes' | 'plan' | 'checks'

export interface SidePanelSettings {
  open: boolean
  width: number
  tab: SidePanelTab
}

export const SIDE_PANEL_TABS: readonly { id: SidePanelTab; label: string }[] = [
  { id: 'changes', label: 'Changes' },
  { id: 'plan', label: 'Plan' },
  { id: 'checks', label: 'Checks' }
]

export const DEFAULT_SIDE_PANEL_WIDTH = 380
export const MIN_SIDE_PANEL_WIDTH = 280
export const MAX_SIDE_PANEL_WIDTH = 640
/** The session beside the panel never gets narrower than this. */
export const MIN_SESSION_WIDTH = 420

export const DEFAULT_SIDE_PANEL: SidePanelSettings = { open: true, width: DEFAULT_SIDE_PANEL_WIDTH, tab: 'changes' }

export const isSidePanelTab = (value: unknown): value is SidePanelTab => value === 'changes' || value === 'plan' || value === 'checks'

/** A saved or dragged width kept inside the limits; the default for anything that is not a number. */
export function clampSidePanelWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SIDE_PANEL_WIDTH
  return Math.round(Math.min(MAX_SIDE_PANEL_WIDTH, Math.max(MIN_SIDE_PANEL_WIDTH, value)))
}

/** The width to draw: the wanted one, narrowed so the session keeps its minimum on a small window. */
export function fitSidePanelWidth(wanted: number, available: number): number {
  const room = Math.max(MIN_SIDE_PANEL_WIDTH, available - MIN_SESSION_WIDTH)
  return Math.min(clampSidePanelWidth(wanted), room)
}

export function sanitizeSidePanel(value: unknown): SidePanelSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    open: raw.open !== false,
    width: clampSidePanelWidth(raw.width),
    tab: isSidePanelTab(raw.tab) ? raw.tab : DEFAULT_SIDE_PANEL.tab
  }
}
