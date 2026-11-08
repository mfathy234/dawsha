import { focusPane } from '../actions'
import { h } from '../dom'
import { store } from '../state'

const PREVIEW_MAX = 140

export const whenText = (ms: number): string =>
  new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function preview(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line
}

export const paneIsOpen = (paneId: string | undefined): boolean => paneId !== undefined && store.state.panes.some((pane) => pane.id === paneId)

/** A button to a run's pane, or nothing once that pane has been closed. */
export function paneLink(paneId: string | undefined, label: string): HTMLElement | null {
  if (!paneId || !paneIsOpen(paneId)) return null
  return h('button', { class: 'btn ghost small', type: 'button', 'data-pane-link': paneId, 'aria-label': label, onClick: () => focusPane(paneId) }, 'Open pane')
}

/** One list row: a name line with actions, then detail lines. */
export function automationRow(id: string, head: (Node | null)[], details: (Node | string | null)[]): HTMLElement {
  return h('li', { 'data-id': id },
    h('div', { class: 'work-ticket-row' },
      h('div', { class: 'work-ticket-head' }, ...head),
      ...details.map((line) => (line === null ? null : h('div', { class: 'work-item-meta' }, line)))))
}

export const spacer = (): HTMLElement => h('span', { class: 'spacer' })
