import { pickerRows, type BranchList, type PickerRow, type SwitchMode } from '../../shared/gitBranches'
import { moveSelection } from '../../shared/quickPick'
import { api } from '../api'
import { clear, h, icon } from '../dom'
import { runQuick } from '../gitQuickActions'
import { ICONS } from '../icons'
import { toast } from './toast'
import { popupDismissButton } from './popupDismiss'

interface Refusal {
  message: string
  branch: string
  mode: SwitchMode
}

interface Target {
  branch: string
  mode: SwitchMode
}

function targetOf(row: PickerRow): Target | null {
  if (row.kind === 'local') return { branch: row.name, mode: 'local' }
  if (row.kind === 'remote') return { branch: row.remote, mode: 'remote' }
  if (row.kind === 'create') return { branch: row.name, mode: 'create' }
  return null
}

function titleOf(row: PickerRow): string {
  if (row.kind === 'create') return `Create branch ${row.name} from ${row.from}`
  if (row.kind === 'invalid') return `${row.name}: ${row.problem}`
  return row.name
}

function hintOf(row: PickerRow): string {
  if (row.kind === 'local') return row.current ? 'current' : ''
  if (row.kind === 'remote') return row.remote
  return ''
}

const GROUPS: [string, (row: PickerRow) => boolean][] = [
  ['Local', (row) => row.kind === 'local'],
  ['Remote', (row) => row.kind === 'remote'],
  ['New', (row) => row.kind === 'create' || row.kind === 'invalid']
]

export async function openBranchPicker(folder: string): Promise<void> {
  const loaded = await api.gitBranches(folder)
  if (!loaded.ok) {
    toast(loaded.error)
    return
  }
  const list: BranchList = loaded.branches
  const previous = document.activeElement as HTMLElement | null
  let ordered: PickerRow[] = []
  let selected = 0
  let refusal: Refusal | null = null
  let busy = false

  const input = h('input', {
    class: 'palette-input',
    type: 'text',
    placeholder: 'Switch to a branch, or type a new name',
    'aria-label': 'Switch branch',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'branch-list',
    autocomplete: 'off',
    spellcheck: 'false'
  })
  const results = h('div', { class: 'palette-list', id: 'branch-list', role: 'listbox', 'aria-label': 'Branches' })
  const dialog = h(
    'div',
    { class: 'palette branch-picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Switch branch' },
    h('div', { class: 'palette-head' }, icon(ICONS.branch), input, popupDismissButton(() => close())),
    results,
    h(
      'div',
      { class: 'palette-foot' },
      h('span', { class: 'palette-hint-item' }, 'Enter switches. A new name offers to create it'),
      h('span', { class: 'palette-hint-item' }, 'Esc closes')
    )
  )
  const overlay = h('div', { class: 'overlay palette-overlay' }, dialog)

  const close = (): void => {
    overlay.remove()
    requestAnimationFrame(() => {
      if (!document.querySelector('.overlay, .popover')) previous?.focus()
    })
  }

  const select = (index: number): void => {
    selected = index
    results.querySelectorAll('.palette-row').forEach((row, position) => {
      const on = position === index
      row.classList.toggle('selected', on)
      row.setAttribute('aria-selected', String(on))
      if (on) row.scrollIntoView({ block: 'nearest' })
    })
  }

  const render = (): void => {
    const rows = pickerRows(list, input.value)
    ordered = []
    clear(results)
    if (refusal) {
      results.append(h('p', { class: 'palette-empty branch-refusal', role: 'alert' }, refusal.message))
      results.append(row(h('span', { class: 'palette-title' }, `Stash and switch to ${refusal.branch}`), ICONS.download, 'stash-switch'))
    }
    for (const [label, belongs] of GROUPS) {
      const group = rows.filter(belongs)
      if (group.length === 0) continue
      results.append(h('div', { class: 'palette-group', role: 'presentation' }, label))
      for (const item of group) {
        ordered.push(item)
        results.append(rowFor(item))
      }
    }
    const total = results.querySelectorAll('.palette-row').length
    if (total === 0) results.append(h('p', { class: 'palette-empty' }, 'No branches match.'))
    select(Math.min(selected, Math.max(0, total - 1)))
  }

  const attempt = async (target: Target, stash: boolean): Promise<void> => {
    if (busy) return
    busy = true
    const result = await runQuick({ folder, op: 'switch', branch: target.branch, mode: target.mode, stash })
    busy = false
    if (result.ok) {
      close()
      toast(result.message, 'info')
    } else if (result.canStash) {
      refusal = { message: result.error, branch: target.branch, mode: target.mode }
      selected = 0
      render()
    } else {
      close()
      toast(result.error)
    }
  }

  function row(body: HTMLElement, svg: string, action: string): HTMLElement {
    const element = h(
      'div',
      { class: 'palette-row', role: 'option', 'aria-selected': 'false', 'data-action': action },
      h('span', { class: 'palette-lead' }, icon(svg)),
      body
    )
    element.addEventListener('click', () => {
      if (refusal) void attempt({ branch: refusal.branch, mode: refusal.mode }, true)
    })
    return element
  }

  function rowFor(item: PickerRow): HTMLElement {
    const target = targetOf(item)
    const hint = hintOf(item)
    const element = h(
      'div',
      {
        class: `palette-row${target ? '' : ' branch-invalid'}`,
        role: 'option',
        'aria-selected': 'false',
        'aria-disabled': target ? 'false' : 'true',
        'data-branch': item.name,
        'data-kind': item.kind
      },
      h('span', { class: 'palette-lead' }, icon(item.kind === 'create' ? ICONS.plus : ICONS.branch)),
      h('span', { class: 'palette-title' }, titleOf(item)),
      hint ? h('span', { class: 'palette-hint' }, hint) : null
    )
    if (target) element.addEventListener('click', () => void attempt(target, false))
    return element
  }

  const choose = (): void => {
    if (refusal && selected === 0) {
      void attempt({ branch: refusal.branch, mode: refusal.mode }, true)
      return
    }
    const picked = ordered[selected - (refusal ? 1 : 0)]
    const target = picked ? targetOf(picked) : null
    if (target) void attempt(target, false)
  }

  input.addEventListener('input', () => {
    refusal = null
    selected = 0
    render()
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const total = results.querySelectorAll('.palette-row').length
      select(moveSelection(selected, event.key === 'ArrowDown' ? 1 : -1, total))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose()
    }
  })
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close()
  })
  document.body.appendChild(overlay)
  render()
  input.focus()
}
