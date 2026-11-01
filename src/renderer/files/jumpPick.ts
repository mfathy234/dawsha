import { moveSelection } from '../../shared/quickPick'
import { h } from '../dom'
import { LatestGate } from './asyncGuard'

export interface PickItem {
  id: string
  label: string
  /** Quiet text after the label: a folder, or the line number. */
  detail?: string
  /** A heading row shown before this item when it starts a new group. */
  group?: string
  indent?: boolean
  run(): void
}

export interface PickSpec {
  ariaLabel: string
  placeholder: string
  /** The rows for the text typed so far. May be slow: only the newest answer is shown. */
  items(query: string): PickItem[] | Promise<PickItem[]>
  /** Shown when there are no rows. */
  empty(query: string): string
  /** Enter with no row chosen (Go to Line takes the number typed). Returns true when it handled the key. */
  submit?(query: string): boolean
  /** Wait this long after typing before asking for rows; 0 asks at once. */
  delayMs?: number
  /** Where focus goes after the picker closes. */
  restoreFocus?(): void
}

interface Open {
  el: HTMLElement
  close(): void
}

let current: Open | null = null

export const jumpPickOpen = (): boolean => current !== null

export function closeJumpPick(): void {
  current?.close()
}

/** A small search box floating over the editor with a list under it: Go to Symbol, Go to Line and Go to Everything. */
export function openJumpPick(host: HTMLElement, spec: PickSpec): void {
  closeJumpPick()
  const gate = new LatestGate()
  let rows: PickItem[] = []
  let selected = 0
  let timer: number | undefined
  let working: Promise<void> = Promise.resolve()
  const input = h('input', { class: 'nav-pick-input', type: 'text', 'aria-label': spec.ariaLabel, placeholder: spec.placeholder, autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'nav-pick-list' })
  const list = h('div', { class: 'nav-pick-list', id: 'nav-pick-list', role: 'listbox', 'aria-label': spec.ariaLabel })
  const el = h('div', { class: 'nav-pick', role: 'dialog', 'aria-label': spec.ariaLabel }, input, list)

  const close = (): void => {
    if (current?.el !== el) return
    current = null
    window.clearTimeout(timer)
    gate.cancel()
    document.removeEventListener('mousedown', outside, true)
    el.remove()
    spec.restoreFocus?.()
  }
  const outside = (event: MouseEvent): void => {
    if (!el.contains(event.target as Node)) close()
  }
  const choose = (item: PickItem): void => {
    close()
    item.run()
  }
  const paint = (): void => {
    if (rows.length === 0) {
      list.replaceChildren(h('div', { class: 'nav-pick-empty' }, spec.empty(input.value.trim())))
      return
    }
    list.replaceChildren(...rows.flatMap((item, index) => [
      ...(item.group && rows[index - 1]?.group !== item.group ? [h('div', { class: 'nav-pick-group', role: 'presentation' }, item.group)] : []),
      h('button', {
        class: `nav-pick-row${index === selected ? ' sel' : ''}`, type: 'button', role: 'option', id: `nav-pick-${index}`, 'aria-selected': String(index === selected), tabindex: '-1',
        onMousedown: (event: Event) => event.preventDefault(), onClick: () => choose(item)
      }, h('span', { class: item.indent ? 'nav-pick-label sub' : 'nav-pick-label' }, item.label), item.detail ? h('small', {}, item.detail) : null)
    ]))
    input.setAttribute('aria-activedescendant', `nav-pick-${selected}`)
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
  }
  const refresh = (): Promise<void> => {
    working = load()
    return working
  }
  const load = async (): Promise<void> => {
    const ticket = gate.begin()
    const found = await Promise.resolve(spec.items(input.value.trim())).catch(() => [])
    if (!ticket.current()) return
    rows = found
    selected = 0
    paint()
  }

  input.addEventListener('input', () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      void refresh()
    }, spec.delayMs ?? 0)
  })
  // Enter right after typing waits for the rows of what was typed, not the ones of the keystroke before.
  const settle = async (): Promise<void> => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
      void refresh()
    }
    await working
  }
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      selected = moveSelection(selected, event.key === 'ArrowDown' ? 1 : -1, rows.length)
      paint()
    } else if (event.key === 'Enter') {
      void settle().then(() => {
        if (current?.el !== el) return
        const item = rows[selected]
        if (item) choose(item)
        else if (spec.submit?.(input.value.trim())) close()
      })
    } else return
    event.preventDefault()
    event.stopPropagation()
  })
  current = { el, close }
  host.append(el)
  document.addEventListener('mousedown', outside, true)
  input.focus()
  void refresh()
}
