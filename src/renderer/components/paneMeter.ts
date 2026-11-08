import type { PaneInfo } from '../derive'
import { formatCost, formatPercent } from '../../shared/statusLine'
import { formatTokens } from '../../shared/usage'
import { h } from '../dom'
import { formatMemory } from '../../shared/paneMemory'

function row(label: string, value: string): HTMLElement {
  return h('div', { class: 'meter-row' }, h('span', { class: 'chat-quiet' }, label), h('span', {}, value))
}

let closeOpen: (() => void) | null = null
let openAnchor: HTMLElement | null = null

/** Opens the information already known for a pane; a second click on the same footer, Escape and outside pointer close it. */
export function openPaneMeter(anchor: HTMLElement, info: PaneInfo, compact: () => void): void {
  const sameAnchor = openAnchor === anchor
  closeOpen?.()
  if (sameAnchor) return
  const rows: HTMLElement[] = []
  if (info.model) rows.push(row('Model', info.model.label))
  if (info.contextPercent !== null) {
    const amount = info.contextTokens !== null && info.contextWindow !== null
      ? ` · ${formatTokens(info.contextTokens)} of ${formatTokens(info.contextWindow)}` : ''
    rows.push(row('Context used', `${formatPercent(info.contextPercent)}${amount}`))
  }
  if (info.tokens !== null) rows.push(row('Tokens', formatTokens(info.tokens)))
  if (info.memoryBytes !== null) rows.push(row('Session memory', formatMemory(info.memoryBytes)))
  if (info.agent === 'claude' && info.costUsd !== null) rows.push(row('Cost', formatCost(info.costUsd)))
  for (const limit of info.limits) {
    const reset = limit.resetsAt === null ? '' : ` · resets ${new Date(limit.resetsAt).toLocaleString()}`
    rows.push(row(`${limit.label} limit`, `${formatPercent(limit.percent)}${reset}`))
  }
  const popup = h('div', { class: 'popover pane-meter-popover', role: 'dialog', 'aria-label': 'Usage details' }, ...rows,
    info.contextPercent !== null && info.contextPercent >= 75 && (info.agent === 'claude' || info.agent === 'codex')
      ? h('button', { class: 'btn small', type: 'button', onClick: () => { close(); compact() } }, 'Compact') : null)
  document.body.append(popup)
  const rect = anchor.getBoundingClientRect()
  popup.style.position = 'fixed'
  popup.style.left = `${Math.min(rect.left, innerWidth - popup.offsetWidth - 8)}px`
  popup.style.top = `${Math.max(8, rect.top - popup.offsetHeight - 6)}px`
  const outside = (event: PointerEvent): void => { if (!popup.contains(event.target as Node) && !anchor.contains(event.target as Node)) close() }
  const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
  function close(): void {
    closeOpen = null
    openAnchor = null
    popup.remove()
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', escape, true)
  }
  closeOpen = close
  openAnchor = anchor
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', escape, true)
}
