import { monogram, railBadge, railTileState } from '../../shared/sidebarModel'
import { projectColor } from '../../shared/projectColor'
import { projectStatusLabel, type ProjectStatus } from '../../shared/projectStatus'
import type { SessionState } from '../../shared/sessionState'
import type { Project } from '../../shared/types'
import { h } from '../dom'
import './railTiles.css'

export type RailGroup = 'needs' | 'open' | 'empty'

/** The dawsha-image URL of a project's icon; the version changes when the name or icon choice does, so a rename or a new pick loads it again. */
export const projectIconUrl = (project: Project): string => `dawsha-image://project/${encodeURIComponent(project.id)}?v=${encodeURIComponent(`${project.name}|${project.iconPath ?? ''}|${project.noIcon === true}`)}`

function iconImage(project: Project, button: HTMLElement, letters: HTMLElement): HTMLImageElement | null {
  if (project.noIcon === true) return null
  const image = h('img', { class: 'rail-icon', alt: '', draggable: 'false', hidden: true }) as HTMLImageElement
  image.addEventListener('load', () => {
    image.hidden = false
    letters.hidden = true
    button.classList.add('has-image')
  })
  image.addEventListener('error', () => image.remove())
  image.src = projectIconUrl(project)
  return image
}

/** One project's tile in the collapsed rail: a coloured circle with letters or the project's icon, a pill on the left, and the needs-you count. */
export function railTile(project: Project, status: ProjectStatus, states: readonly SessionState[], selected: boolean, group: RailGroup, onClick: () => void): HTMLButtonElement {
  const label = projectStatusLabel(project.name, status)
  const state = railTileState(status, selected)
  const color = projectColor(project.name)
  const letters = h('span', { class: 'rail-letters', 'aria-hidden': 'true' }, monogram(project.name))
  const button = h('button', { class: `rail-btn rail-mono rail-tile rail-${state}`, type: 'button', 'aria-label': label, 'aria-haspopup': 'menu', 'data-menu-key': `fly:${project.id}`, 'data-tip': label, onClick }) as HTMLButtonElement
  button.style.setProperty('--tile-bg', color.bg)
  button.style.setProperty('--tile-fg', color.fg)
  const image = iconImage(project, button, letters)
  button.append(h('span', { class: 'rail-pill', 'aria-hidden': 'true' }), h('span', { class: 'rail-face' }, letters, image))
  button.dataset.dropProject = project.id
  button.dataset.railGroup = group
  button.classList.toggle('selected', selected)
  button.classList.toggle('has-unread', status.unread > 0)
  const badge = railBadge(states)
  if (badge) button.append(h('span', { class: 'rail-badge needs', 'aria-hidden': 'true' }, badge))
  return button
}

let tip: HTMLElement | null = null

function showTip(target: HTMLElement): void {
  const text = target.dataset.tip
  if (!text) return
  tip ??= h('div', { class: 'rail-tip', role: 'tooltip' })
  tip.textContent = text
  if (!tip.isConnected) document.body.append(tip)
  const box = target.getBoundingClientRect()
  tip.style.top = `${box.top + box.height / 2}px`
  tip.style.left = `${box.right + 14}px`
  tip.classList.add('shown')
}

const hideTip = (): void => tip?.classList.remove('shown')

/** Shows a dark bubble to the right of any [data-tip] element inside the rail, on hover and on keyboard focus. */
export function installRailTips(root: HTMLElement): void {
  const tipped = (event: Event): HTMLElement | null => (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null)
  root.addEventListener('mouseover', (event) => { const target = tipped(event); if (target) showTip(target) })
  root.addEventListener('mouseout', (event) => { if (tipped(event)) hideTip() })
  root.addEventListener('focusin', (event) => { const target = tipped(event); if (target && target.matches(':focus-visible')) showTip(target) })
  root.addEventListener('focusout', hideTip)
  root.addEventListener('pointerdown', hideTip)
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
