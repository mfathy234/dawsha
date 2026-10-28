export const PANEL_MIN_HEIGHT = 120
export const PANEL_DEFAULT_HEIGHT = 220
export const PANEL_MAX_FRACTION = 0.7
/** Below this window width the inspector hides itself, whatever the toggle says. */
export const INSPECTOR_MIN_WIDTH = 1180

export type InspectorTab = 'outline' | 'activity'
export type SectionId = 'changes' | 'open' | 'tree'

export interface FilesLayout {
  sections: Record<SectionId, boolean>
  inspector: { open: boolean; tab: InspectorTab }
  panel: { minimised: boolean; height: number }
}

export const defaultLayout = (): FilesLayout => ({
  sections: { changes: true, open: true, tree: true },
  inspector: { open: true, tab: 'outline' },
  panel: { minimised: true, height: PANEL_DEFAULT_HEIGHT }
})

/** The panel height that fits: not under its minimum, and never more than most of the main area. */
export function clampPanelHeight(height: number, available: number): number {
  const max = Math.max(PANEL_MIN_HEIGHT, Math.floor(available * PANEL_MAX_FRACTION))
  const wanted = Number.isFinite(height) ? Math.round(height) : PANEL_DEFAULT_HEIGHT
  return Math.min(Math.max(wanted, PANEL_MIN_HEIGHT), max)
}

/** A saved layout read back from storage, with anything missing or wrong replaced by the default. */
export function parseLayout(raw: unknown): FilesLayout {
  const base = defaultLayout()
  if (typeof raw !== 'object' || raw === null) return base
  const value = raw as Record<string, unknown>
  const sections = typeof value.sections === 'object' && value.sections !== null ? (value.sections as Record<string, unknown>) : {}
  const inspector = typeof value.inspector === 'object' && value.inspector !== null ? (value.inspector as Record<string, unknown>) : {}
  const panel = typeof value.panel === 'object' && value.panel !== null ? (value.panel as Record<string, unknown>) : {}
  return {
    sections: {
      changes: typeof sections.changes === 'boolean' ? sections.changes : base.sections.changes,
      open: typeof sections.open === 'boolean' ? sections.open : base.sections.open,
      tree: typeof sections.tree === 'boolean' ? sections.tree : base.sections.tree
    },
    inspector: {
      open: typeof inspector.open === 'boolean' ? inspector.open : base.inspector.open,
      tab: inspector.tab === 'activity' ? 'activity' : 'outline'
    },
    panel: {
      minimised: typeof panel.minimised === 'boolean' ? panel.minimised : base.panel.minimised,
      height: typeof panel.height === 'number' && Number.isFinite(panel.height) ? Math.min(Math.max(Math.round(panel.height), PANEL_MIN_HEIGHT), 2000) : base.panel.height
    }
  }
}
