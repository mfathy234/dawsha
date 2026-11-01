import { branchAgo, filterBranches, typedBranchRow, type BranchEntry, type BranchList, type SwitchMode } from '../../shared/gitBranches'
import { placeMenu } from '../../shared/menuPlacement'
import { clear, h, icon, leave } from '../dom'
import { ICONS } from '../icons'

export interface BranchTarget {
  branch: string
  mode: SwitchMode
}

/** An action kept under the branches, like Pull or Fetch in the pane footer. */
export interface BranchMenuExtra {
  id: string
  label: string
  icon: string
  run(): void
}

export interface BranchMenuOptions {
  anchor: HTMLElement
  list: BranchList
  now: number
  /** A branch row, or the typed name offered as a new branch (`mode: 'create'`). */
  pick(target: BranchTarget): void
  /** The "+ New branch…" row: the opener asks for a name. */
  create(): void
  extras?: readonly BranchMenuExtra[]
  /** Called when the menu closes, so the opener can reset its expanded state and focus. */
  closed(focusAnchor: boolean): void
}

const ITEMS = '.files-bm-item:not([disabled]), .files-bm-new, .files-bm-extra'

let active: { anchor: HTMLElement; close: (focusAnchor: boolean) => void } | null = null

/** True while the branch menu is open from this button, so a second click can close it instead of reopening it. */
export function branchMenuOpenFor(anchor: HTMLElement): boolean {
  return active?.anchor === anchor
}

export function closeBranchListMenu(focusAnchor = false): void {
  active?.close(focusAnchor)
}

function rowButton(name: string, mode: SwitchMode, entry: BranchEntry, now: number, pick: (target: BranchTarget) => void): HTMLElement {
  const ago = branchAgo(entry.date, now)
  return h('button', {
    class: 'menu-item ctx-item files-bm-item', type: 'button', role: 'menuitem', 'data-branch': name, 'data-mode': mode,
    'aria-current': entry.current ? 'true' : undefined, onClick: () => pick({ branch: name, mode })
  },
  h('span', { class: 'ctx-label' }, entry.name),
  ago ? h('span', { class: 'files-bm-ago' }, ago) : null,
  h('span', { class: 'ctx-check files-bm-tick', 'aria-label': entry.current ? 'Current branch' : undefined, 'aria-hidden': entry.current ? undefined : 'true' }, entry.current ? icon(ICONS.check) : null))
}

function typedRow(list: BranchList, query: string, pick: (target: BranchTarget) => void): HTMLElement | null {
  const row = typedBranchRow(list, query)
  if (!row) return null
  if (row.kind === 'invalid') {
    return h('p', { class: 'files-bm-empty files-bm-invalid', 'data-kind': 'invalid', role: 'status' }, `${row.name}: ${row.problem}`)
  }
  return h('button', { class: 'menu-item ctx-item files-bm-item files-bm-create', type: 'button', role: 'menuitem', 'data-kind': 'create', 'data-branch': row.name, 'data-mode': 'create', onClick: () => pick({ branch: row.name, mode: 'create' }) },
  icon(ICONS.plus), h('span', { class: 'ctx-label' }, `Create branch ${row.name} `), h('span', { class: 'files-bm-ago' }, `from ${row.from}`))
}

function extraItem(extra: BranchMenuExtra, run: (extra: BranchMenuExtra) => void): HTMLElement {
  return h('button', { class: 'menu-item ctx-item files-bm-extra', type: 'button', role: 'menuitem', 'data-git': extra.id, onClick: () => run(extra) },
    icon(extra.icon), h('span', { class: 'ctx-label' }, extra.label))
}

/** The branch dropdown: a find-or-create field, recent (local) branches with the current one ticked, remote-only branches, New branch and optional extra actions. */
export function openBranchListMenu(options: BranchMenuOptions): HTMLElement {
  closeBranchListMenu()
  const { list } = options
  const input = h('input', { class: 'text-input files-bm-filter', type: 'text', placeholder: 'Find or create a branch…', 'aria-label': 'Find or create a branch', autocomplete: 'off', spellcheck: 'false' })
  const body = h('div', { class: 'files-bm-list' })
  const el = h('div', { class: 'popover menu floating ctx-menu files-branch-menu', role: 'menu', 'aria-label': 'Branches' }, input, body)
  let open = true

  const close = (focusAnchor: boolean): void => {
    if (!open) return
    open = false
    if (active?.close === close) active = null
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('blur', dismiss)
    window.removeEventListener('resize', dismiss)
    leave(el)
    options.closed(focusAnchor)
  }
  const picked = (target: BranchTarget): void => {
    close(false)
    options.pick(target)
  }
  function outside(event: Event): void {
    const target = event.target as Node
    if (!el.contains(target) && !options.anchor.contains(target)) close(false)
  }
  function dismiss(): void {
    close(false)
  }

  const render = (): void => {
    const query = input.value
    const shown = filterBranches(list, query)
    clear(body)
    if (shown.local.length > 0) {
      body.append(h('div', { class: 'ctx-heading', role: 'presentation' }, 'Recent'))
      for (const entry of shown.local) body.append(rowButton(entry.name, 'local', entry, options.now, picked))
    }
    if (shown.remote.length > 0) {
      body.append(h('div', { class: 'ctx-heading', role: 'presentation' }, 'Remote'))
      for (const entry of shown.remote) body.append(rowButton(entry.remote ?? entry.name, 'remote', entry, options.now, picked))
    }
    const typed = typedRow(list, query, picked)
    if (typed) body.append(typed)
    else if (shown.local.length + shown.remote.length === 0) body.append(h('p', { class: 'files-bm-empty' }, 'No branches match.'))
  }

  const footer = h('button', { class: 'menu-item ctx-item files-bm-new', type: 'button', role: 'menuitem', onClick: () => {
    close(false)
    options.create()
  } }, icon(ICONS.plus), h('span', { class: 'ctx-label' }, 'New branch…'))
  el.append(h('div', { class: 'ctx-sep', role: 'separator' }), footer)
  if (options.extras && options.extras.length > 0) {
    el.append(h('div', { class: 'ctx-sep', role: 'separator' }), ...options.extras.map((extra) => extraItem(extra, (chosen) => {
      close(false)
      chosen.run()
    })))
  }
  render()

  el.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    const enabled = [...el.querySelectorAll<HTMLElement>(ITEMS)]
    const at = enabled.indexOf(document.activeElement as HTMLElement)
    const go = (next: HTMLElement | undefined): void => {
      event.preventDefault()
      event.stopPropagation()
      next?.focus()
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ArrowDown') go(enabled[(at + 1) % enabled.length])
    else if (event.key === 'ArrowUp') go(enabled[(at <= 0 ? enabled.length : at) - 1])
    else if (event.key === 'Enter' && document.activeElement === input) {
      event.preventDefault()
      body.querySelector<HTMLElement>(ITEMS)?.click()
    }
  })
  input.addEventListener('input', render)

  document.body.appendChild(el)
  const placed = placeMenu(options.anchor.getBoundingClientRect(), el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, 2)
  el.style.left = `${placed.left}px`
  el.style.top = `${placed.top}px`
  el.style.right = 'auto'
  if (placed.maxHeight !== null) el.style.maxHeight = `${placed.maxHeight}px`
  input.focus()
  active = { anchor: options.anchor, close }
  window.setTimeout(() => {
    if (!open) return
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
  }, 0)
  return el
}
