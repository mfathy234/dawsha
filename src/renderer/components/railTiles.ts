import { monogram, railBadge, railTileState } from '../../shared/sidebarModel'
import { projectStatusLabel, type ProjectStatus } from '../../shared/projectStatus'
import type { SessionState } from '../../shared/sessionState'
import type { Project } from '../../shared/types'
import { h } from '../dom'
import './railTiles.css'

export type RailGroup = 'needs' | 'open' | 'empty'

/** One project's tile in the collapsed rail: letters, state class and the needs-you count. */
export function railTile(project: Project, status: ProjectStatus, states: readonly SessionState[], selected: boolean, group: RailGroup, onClick: () => void): HTMLButtonElement {
  const label = projectStatusLabel(project.name, status)
  const state = railTileState(status, selected)
  const button = h(
    'button',
    { class: `rail-btn rail-mono rail-tile rail-${state}`, type: 'button', 'aria-label': label, title: label, 'aria-haspopup': 'menu', 'data-menu-key': `fly:${project.id}`, onClick },
    h('span', { class: 'rail-letters', 'aria-hidden': 'true' }, monogram(project.name))
  )
  button.dataset.dropProject = project.id
  button.dataset.railGroup = group
  button.classList.toggle('selected', selected)
  const badge = railBadge(states)
  if (badge) button.append(h('span', { class: 'rail-badge needs', 'aria-hidden': 'true' }, badge))
  return button
}

/** The dots tile that folds the projects without sessions. */
export function railMoreTile(count: number, expanded: boolean, onToggle: () => void): HTMLButtonElement {
  const label = expanded ? 'Hide projects without sessions' : `${count} project${count === 1 ? '' : 's'} without sessions`
  return h('button', { class: 'rail-btn rail-more', type: 'button', id: 'rail-more', 'aria-label': label, title: label, 'aria-expanded': String(expanded), onClick: onToggle }, h('span', { 'aria-hidden': 'true' }, '···'))
}

const FADE = '12px'

/** Fades the scroller's top and bottom edges only where more tiles lie beyond them. */
export function syncRailFade(scroller: HTMLElement): void {
  const top = scroller.scrollTop > 0
  const bottom = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
  scroller.style.setProperty('--fade-top', top ? FADE : '0px')
  scroller.style.setProperty('--fade-bottom', bottom ? FADE : '0px')
}

export function railScroller(...tiles: (HTMLElement | null)[]): HTMLElement {
  const scroller = h('div', { class: 'rail-projects' }, ...tiles)
  scroller.addEventListener('scroll', () => syncRailFade(scroller), { passive: true })
  requestAnimationFrame(() => syncRailFade(scroller))
  return scroller
}
