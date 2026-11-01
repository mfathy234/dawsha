import type { CodeNavHit } from '../../shared/codeNav'
import type { CallHierarchyResult } from '../../shared/codeNavExtras'
import { h, icon } from '../dom'
import { ICONS } from '../icons'

export type CallDirection = 'incoming' | 'outgoing'

export interface CallPanelSpec {
  symbol: string
  load(direction: CallDirection): Promise<CallHierarchyResult>
  open(hit: CodeNavHit): void
  restoreFocus(): void
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const TITLES: Record<CallDirection, string> = { incoming: 'Callers of', outgoing: 'Calls made by' }
const NEEDS_SERVER = 'Call hierarchy needs a language server. Start or install one for this file type, then try again.'

let current: { close(): void } | null = null

/** Call hierarchy: who calls the name under the caret, or what it calls. One list, switched between the two. */
export function openCallPanel(host: HTMLElement, spec: CallPanelSpec): void {
  current?.close()
  let direction: CallDirection = 'incoming'
  let token = 0
  const title = h('b', { class: 'call-title' })
  const list = h('div', { class: 'call-list', role: 'list' })
  const note = h('p', { class: 'call-note', role: 'status' })
  const tab = (value: CallDirection, label: string): HTMLButtonElement => h('button', { class: 'files-seg', type: 'button', 'data-direction': value, onClick: () => show(value) }, label)
  const tabs = { incoming: tab('incoming', 'Callers'), outgoing: tab('outgoing', 'Calls') }
  const close = h('button', { class: 'nav-peek-close', type: 'button', 'aria-label': 'Close call hierarchy', title: 'Close (Esc)', onClick: () => dismiss() }, icon(ICONS.close))
  const el = h('section', { class: 'call-panel', role: 'dialog', 'aria-label': 'Call hierarchy', tabindex: '-1' },
    h('div', { class: 'call-head' }, title, h('div', { class: 'files-segment', role: 'group', 'aria-label': 'Direction' }, tabs.incoming, tabs.outgoing), h('span', { class: 'grow' }), close),
    note, list)

  const dismiss = (): void => {
    if (current?.close !== dismiss) return
    current = null
    token += 1
    el.remove()
    spec.restoreFocus()
  }
  current = { close: dismiss }

  const row = (hit: CodeNavHit, label: string, sub = false): HTMLElement =>
    h('button', { class: `call-row${sub ? ' sub' : ''}`, type: 'button', role: 'listitem', title: `${hit.path}:${hit.line}`, onClick: () => { dismiss(); spec.open(hit) } },
      h('span', { class: 'call-label' }, label), h('small', {}, `${baseName(hit.path)}:${hit.line}`))

  const render = (result: CallHierarchyResult): void => {
    if (!result.ok) {
      list.replaceChildren()
      note.textContent = result.needsLanguageServer ? NEEDS_SERVER : result.error
      return
    }
    const byName = result.engine === 'name' ? 'Best guesses by name. ' : ''
    const outside = result.outside ? 'Some of these are in code outside this project and are not listed. ' : ''
    note.textContent = result.items.length === 0 ? `${byName}${outside}Nothing found.`.trim() : `${byName}${outside}`.trim()
    list.replaceChildren(...result.items.flatMap((item) => [
      row(item.symbol, item.name),
      ...item.calls.map((call) => row(call, call.preview, true))
    ]))
  }

  const show = (value: CallDirection): void => {
    direction = value
    const mine = ++token
    for (const [key, button] of Object.entries(tabs)) button.setAttribute('aria-pressed', String(key === value))
    title.textContent = `${TITLES[value]} ${spec.symbol}`
    note.textContent = 'Loading…'
    list.replaceChildren()
    void spec.load(value).catch((error: Error): CallHierarchyResult => ({ ok: false, error: error.message })).then((result) => {
      if (mine === token && direction === value) render(result)
    })
  }

  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = [...list.querySelectorAll<HTMLElement>('.call-row')]
      const at = rows.indexOf(document.activeElement as HTMLElement)
      event.preventDefault()
      rows[Math.min(Math.max(at + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)]?.focus()
    }
  })
  host.append(el)
  show('incoming')
  requestAnimationFrame(() => el.focus({ preventScroll: true }))
}

export const closeCallPanel = (): void => current?.close()
