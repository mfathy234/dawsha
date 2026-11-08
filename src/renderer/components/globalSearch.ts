import { h, icon, leave } from '../dom'
import { ICONS } from '../icons'
import { openSessionHit } from '../globalSearchActions'
import { paneById, store } from '../state'
import { AllSessionsSearch } from './timelineAllSearch'
import { popupDismissButton } from './popupDismiss'
import './quickOpen.css'
import './globalSearch.css'

interface Dialog {
  overlay: HTMLElement
  search: AllSessionsSearch
  previous: HTMLElement | null
}

let dialog: Dialog | null = null

export const globalSearchShowing = (): boolean => dialog !== null

const hint = (key: string, label: string): HTMLElement => h('span', { class: 'qo-hint' }, h('span', { class: 'qo-kbd' }, key), ` ${label}`)

/** The project of the focused pane, offered as a narrower scope like in the timeline. */
function focusedProject(): { id: string; name: string } | null {
  const pane = paneById(store.state, store.state.focusedId)
  const project = store.state.settings.projects.find((entry) => entry.id === pane?.projectId)
  return project ? { id: project.id, name: project.name } : null
}

export function toggleGlobalSearch(): void {
  if (dialog) closeGlobalSearch(true)
  else openGlobalSearch()
}

export function openGlobalSearch(): void {
  if (dialog) return
  const input = h('input', {
    class: 'qo-input', id: 'global-search-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Search every past session', 'aria-label': 'Search all sessions'
  })
  const search = new AllSessionsSearch({
    paneId: 'global-search',
    query: () => input.value,
    filter: () => 'all',
    project: focusedProject,
    projectName: (id) => store.state.settings.projects.find((entry) => entry.id === id)?.name ?? '',
    open: (session, hit) => {
      const query = input.value
      closeGlobalSearch(false)
      openSessionHit(session, hit, query)
    }
  })
  search.el.hidden = false
  search.syncProjects()
  const overlay = h('div', { class: 'overlay qo-overlay' },
    h('div', { class: 'qo gs', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search all sessions' },
      h('div', { class: 'qo-head' }, icon(ICONS.search), input, popupDismissButton(() => closeGlobalSearch(true))),
      h('div', { class: 'gs-body' }, search.el),
      h('div', { class: 'qo-foot' }, hint('Enter', 'search now'), hint('Esc', 'close'))))
  dialog = { overlay, search, previous: document.activeElement as HTMLElement | null }
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeGlobalSearch(true)
  })
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeGlobalSearch(true)
    } else if (event.key === 'Enter' && event.target === input) search.schedule(0)
  })
  input.addEventListener('input', () => search.schedule())
  document.body.appendChild(overlay)
  input.focus()
  search.schedule(0)
}

export function closeGlobalSearch(restoreFocus: boolean): void {
  const current = dialog
  if (!current) return
  dialog = null
  current.search.cancel()
  leave(current.overlay)
  if (restoreFocus) requestAnimationFrame(() => current.previous?.focus())
}
