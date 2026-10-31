import { branchAgo, filterBranches, needsBranchFilter, type BranchEntry, type BranchList, type SwitchMode } from '../../shared/gitBranches'
import { placeMenu } from '../../shared/menuPlacement'
import { clear, h, icon, leave } from '../dom'
import { ICONS } from '../icons'

export interface BranchTarget {
  branch: string
  mode: SwitchMode
}

export interface BranchMenuOptions {
  anchor: HTMLElement
  list: BranchList
  now: number
  pick(target: BranchTarget): void
  create(): void
  /** Called when the menu closes, so the opener can reset its expanded state and focus. */
  closed(focusAnchor: boolean): void
}

const ITEMS = '.files-bm-item:not([disabled])'

function item(entry: BranchEntry, mode: SwitchMode, now: number, pick: (target: BranchTarget) => void): HTMLElement {
  const name = mode === 'remote' ? (entry.remote ?? entry.name) : entry.name
  const ago = branchAgo(entry.date, now)
  return h('button', {
    class: 'menu-item ctx-item files-bm-item', type: 'button', role: 'menuitem', 'data-branch': name, 'data-mode': mode,
    'aria-current': entry.current ? 'true' : undefined, onClick: () => pick({ branch: name, mode })
  },
  h('span', { class: 'ctx-label' }, entry.name),
  ago ? h('span', { class: 'files-bm-ago' }, ago) : null,
  h('span', { class: 'ctx-check files-bm-tick', 'aria-label': entry.current ? 'Current branch' : undefined, 'aria-hidden': entry.current ? undefined : 'true' }, entry.current ? icon(ICONS.check) : null))
}

/** The Files branch dropdown: local branches (current ticked, newest first), a filter when there are many, remote-only branches and New branch. */
export function openBranchMenu(options: BranchMenuOptions): HTMLElement {
  const { list } = options
  const filterable = needsBranchFilter(list)
  const input = filterable ? h('input', { class: 'text-input files-bm-filter', type: 'text', placeholder: 'Filter branches', 'aria-label': 'Filter branches', autocomplete: 'off', spellcheck: 'false' }) : null
  const body = h('div', { class: 'files-bm-list' })
  const el = h('div', { class: 'popover menu floating ctx-menu files-branch-menu', role: 'menu', 'aria-label': 'Branches' }, ...(input ? [input] : []), body)
  let open = true

  const close = (focusAnchor: boolean): void => {
    if (!open) return
    open = false
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
    if (!el.contains(event.target as Node)) close(false)
  }
  function dismiss(): void {
    close(false)
  }

  const render = (): void => {
    const shown = filterBranches(list, input?.value ?? '')
    clear(body)
    if (shown.local.length > 0) {
      body.append(h('div', { class: 'ctx-heading', role: 'presentation' }, 'Local branches'))
      for (const entry of shown.local) body.append(item(entry, 'local', options.now, picked))
    }
    if (shown.remote.length > 0) {
      body.append(h('div', { class: 'ctx-heading', role: 'presentation' }, 'Remote branches'))
      for (const entry of shown.remote) body.append(item(entry, 'remote', options.now, picked))
    }
    if (shown.local.length + shown.remote.length === 0) body.append(h('p', { class: 'files-bm-empty' }, 'No branches match.'))
  }

  const footer = h('button', { class: 'menu-item ctx-item files-bm-new', type: 'button', role: 'menuitem', onClick: () => {
    close(false)
    options.create()
  } }, icon(ICONS.plus), h('span', { class: 'ctx-label' }, 'New branch…'))
  el.append(h('div', { class: 'ctx-sep', role: 'separator' }), footer)
  render()

  el.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    const enabled = [...el.querySelectorAll<HTMLElement>(`${ITEMS}, .files-bm-new`)]
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
      enabled[0]?.click()
    }
  })
  input?.addEventListener('input', render)

  document.body.appendChild(el)
  const placed = placeMenu(options.anchor.getBoundingClientRect(), el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, 2)
  el.style.left = `${placed.left}px`
  el.style.top = `${placed.top}px`
  el.style.right = 'auto'
  if (placed.maxHeight !== null) el.style.maxHeight = `${placed.maxHeight}px`
  ;(input ?? el.querySelector<HTMLElement>(ITEMS))?.focus()
  window.setTimeout(() => {
    if (!open) return
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
  }, 0)
  return el
}
