import type { TodoEntry } from '../shared/chatCards'
import type { ChecksState } from './chat/turnState'

/** What a pane's chat can show in the Side panel: its plan, the card of its latest reply and that reply's checks. */
export interface PanelSource {
  todos(): readonly TodoEntry[]
  card(): { id: string; el: HTMLElement; files: number } | null
  checks(): ChecksState | null
  rerunChecks(): void
  showOutput(): void
}

const sources = new Map<string, PanelSource>()

export const panelSource = (paneId: string): PanelSource | null => sources.get(paneId) ?? null

export function setPanelSource(paneId: string, source: PanelSource | null): void {
  if (source) sources.set(paneId, source)
  else sources.delete(paneId)
}
