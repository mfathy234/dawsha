import { h } from '../dom'
import { paletteShortcutLabel } from '../keyboard'
import { listAllCommands } from '../commands/registry'
import { store } from '../state'
import { buildSheet, filterSheet, fixedEntries, type SheetGroup } from '../../shared/shortcutSheet'
import { nextDialogId, present } from './dialogs'

const mod = (): string => (navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl')

function renderGroups(groups: SheetGroup[]): HTMLElement[] {
  if (groups.length === 0) return [h('p', { class: 'shortcuts-empty' }, 'No shortcut matches.')]
  return groups.map((group) =>
    h(
      'section',
      { class: 'shortcuts-group' },
      h('h3', {}, group.label),
      h(
        'ul',
        { class: 'shortcuts-list' },
        ...group.entries.map((entry) => h('li', {}, h('span', { class: 'shortcuts-title' }, entry.title), h('kbd', { class: 'menu-kbd' }, entry.keys)))
      )
    )
  )
}

// Read-only reference: every command that has a key, plus the keys that are not commands.
export function openShortcutsSheet(): Promise<void> {
  const titleId = `dlg-title-${nextDialogId()}`
  const groups = buildSheet(listAllCommands(store.state), fixedEntries(paletteShortcutLabel(store.state), mod()))
  const search = h('input', { class: 'text-input shortcuts-search', type: 'search', placeholder: 'Search shortcuts', 'aria-label': 'Search shortcuts', autocomplete: 'off' })
  const list = h('div', { class: 'shortcuts-body' }, ...renderGroups(groups))
  const close = h('button', { class: 'btn ghost', type: 'button' }, 'Close')
  const dialog = h(
    'div',
    { class: 'dialog shortcuts-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('h2', { id: titleId }, 'Keyboard shortcuts'),
    search,
    list,
    h('div', { class: 'dialog-actions' }, close)
  )
  const shown = present<void>(dialog, undefined, search)
  search.addEventListener('input', () => list.replaceChildren(...renderGroups(filterSheet(groups, search.value))))
  close.addEventListener('click', () => shown.finish())
  return shown.result
}
