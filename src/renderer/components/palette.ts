import { buildGroups, flatten, jumpGroup, type PaletteGroup, type PaletteRow } from '../../shared/palette'
import { moveSelection } from '../../shared/quickPick'
import { closePalette } from '../actions'
import { clear, h, icon, nextFrame } from '../dom'
import { ICONS } from '../icons'
import { loadRecents, recordRecent } from '../commands/recents'
import { listCommands, type Command } from '../commands/registry'
import { isPaletteShortcut, paletteShortcutLabel } from '../keyboard'
import { store, type AppState } from '../state'
import { getTerminal } from '../terminals'
import { agentMark } from './agentMark'

const GROUP_ICONS: Record<string, string> = {
  Actions: ICONS.bolt,
  Layouts: ICONS.layout,
  Recent: ICONS.history
}

function highlight(text: string, indexes: number[]): (Node | string)[] {
  if (indexes.length === 0) return [text]
  const marked = new Set(indexes)
  const parts: (Node | string)[] = []
  let run = ''
  let runMarked = false
  const flush = (): void => {
    if (run) parts.push(runMarked ? h('mark', { class: 'palette-match' }, run) : run)
    run = ''
  }
  for (const [position, char] of [...text].entries()) {
    const isMarked = marked.has(position)
    if (isMarked !== runMarked) flush()
    runMarked = isMarked
    run += char
  }
  flush()
  return parts
}

function hint(key: string, label: string): HTMLElement {
  return h('span', { class: 'palette-hint-item' }, h('span', { class: 'palette-kbd' }, key), ` ${label}`)
}

export class PaletteComponent {
  private overlay: HTMLElement | null = null
  private input: HTMLInputElement | null = null
  private list: HTMLElement | null = null
  private groups: PaletteGroup<Command>[] = []
  private flat: PaletteRow<Command>[] = []
  private selected = 0
  private previous: HTMLElement | null = null

  update(state: AppState): void {
    if (state.paletteOpen && !this.overlay) this.open()
    if (!state.paletteOpen && this.overlay) this.teardown()
  }

  private open(): void {
    this.previous = document.activeElement as HTMLElement | null
    this.selected = 0
    this.input = h('input', {
      class: 'palette-input',
      id: 'palette-input',
      type: 'text',
      placeholder: 'Type a command, a session or a project',
      'aria-label': 'Command palette',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'palette-list',
      autocomplete: 'off',
      spellcheck: 'false'
    })
    this.list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox', 'aria-label': 'Results' })
    const dialog = h(
      'div',
      { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
      h(
        'div',
        { class: 'palette-head' },
        icon(ICONS.search),
        this.input,
        h('span', { class: 'palette-kbd' }, paletteShortcutLabel(store.state))
      ),
      this.list,
      h(
        'div',
        { class: 'palette-foot' },
        hint('Enter', 'run'),
        hint('Tab', 'next group'),
        hint('Up Down', 'move'),
        hint('Esc', 'close')
      )
    )
    this.overlay = h('div', { class: 'overlay palette-overlay' }, dialog)
    this.overlay.addEventListener('mousedown', (event) => {
      if (event.target === this.overlay) this.dismiss()
    })
    this.input.addEventListener('input', () => {
      this.selected = 0
      this.render()
    })
    this.input.addEventListener('keydown', (event) => this.onKey(event))
    document.body.appendChild(this.overlay)
    this.render()
    this.input.focus()
  }

  private teardown(): void {
    this.overlay?.remove()
    this.overlay = null
    this.input = null
    this.list = null
  }

  private dismiss(): void {
    const previous = this.previous
    closePalette()
    requestAnimationFrame(() => {
      if (!document.querySelector('.overlay, .popover')) previous?.focus()
    })
  }

  private onKey(event: KeyboardEvent): void {
    if (isPaletteShortcut(event, store.state) || event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.dismiss()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      this.select(moveSelection(this.selected, event.key === 'ArrowDown' ? 1 : -1, this.flat.length))
    } else if (event.key === 'Tab') {
      event.preventDefault()
      this.select(jumpGroup(this.groups, this.selected, event.shiftKey ? -1 : 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = this.flat[this.selected]
      if (row) void this.run(row.item)
    }
  }

  private select(index: number): void {
    this.selected = index
    this.list?.querySelectorAll('.palette-row').forEach((row, position) => {
      const on = position === index
      row.classList.toggle('selected', on)
      row.setAttribute('aria-selected', String(on))
      if (on) row.scrollIntoView({ block: 'nearest' })
    })
    this.input?.setAttribute('aria-activedescendant', `palette-row-${index}`)
  }

  private async run(command: Command): Promise<void> {
    recordRecent(command.id)
    closePalette()
    await command.run()
    await nextFrame()
    this.refocus()
  }

  private refocus(): void {
    if (document.querySelector('.overlay, .popover')) return
    if (document.activeElement && document.activeElement !== document.body) return
    const { state } = store
    const pane = state.panes.find((p) => p.id === state.focusedId)
    if (pane && state.view === 'grid') getTerminal(pane.activeTabId)?.focus()
  }

  private render(): void {
    if (!this.list || !this.input) return
    this.groups = buildGroups(listCommands(store.state), this.input.value, loadRecents())
    this.flat = flatten(this.groups)
    this.selected = Math.min(this.selected, Math.max(0, this.flat.length - 1))
    clear(this.list)
    if (this.flat.length === 0) {
      this.list.append(h('p', { class: 'palette-empty' }, 'Nothing matches that.'))
      return
    }
    let position = 0
    for (const group of this.groups) {
      this.list.append(h('div', { class: 'palette-group', role: 'presentation' }, group.label))
      for (const row of group.rows) this.list.append(this.buildRow(row, group.label, position++))
    }
    this.select(this.selected)
  }

  private buildRow(row: PaletteRow<Command>, groupLabel: string, position: number): HTMLElement {
    const { item } = row
    const lead = item.mark ? agentMark(item.mark) : icon(GROUP_ICONS[item.group] ?? GROUP_ICONS[groupLabel] ?? ICONS.bolt)
    const element = h(
      'div',
      {
        class: 'palette-row',
        role: 'option',
        id: `palette-row-${position}`,
        'aria-selected': 'false',
        'data-command': item.id
      },
      h('span', { class: 'palette-lead' }, lead),
      h('span', { class: 'palette-title' }, ...highlight(item.title, row.indexes)),
      item.hint ? h('span', { class: 'palette-hint' }, item.hint) : null,
      item.shortcut ? h('span', { class: 'palette-kbd' }, item.shortcut) : null
    )
    element.addEventListener('mousemove', () => {
      if (this.selected !== position) this.select(position)
    })
    element.addEventListener('click', () => void this.run(item))
    return element
  }
}
