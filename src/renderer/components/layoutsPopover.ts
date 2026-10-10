import { layoutSlug, paneAgent, paneCountText } from '../../shared/layouts'
import type { SavedLayout } from '../../shared/types'
import { toggleLayouts } from '../actions'
import { deleteLayout, openLayoutFromUi, renameLayout, saveCurrentLayout } from '../layoutActions'
import { h } from '../dom'
import { projectById, type AppState } from '../state'
import { agentMark } from './agentMark'

const POPOVER_WIDTH = 460

export class LayoutsPopoverComponent {
  private root: HTMLElement | null = null
  private signature = ''

  constructor(private readonly anchor: () => HTMLElement) {}

  update(state: AppState): void {
    if (state.layoutsOpen && !this.root) this.open()
    if (!state.layoutsOpen && this.root) this.close()
    if (this.root) this.render(state)
  }

  private open(): void {
    const rect = this.anchor().getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 16))
    this.root = h('div', {
      class: 'popover layouts-popover',
      role: 'dialog',
      'aria-label': 'Saved layouts',
      style: `left:${Math.round(left)}px;top:${Math.round(rect.bottom + 6)}px`
    })
    document.body.appendChild(this.root)
    document.addEventListener('pointerdown', this.outside, true)
    document.addEventListener('keydown', this.onEscape, true)
    this.signature = ''
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.root && !this.root.contains(target) && !this.anchor().contains(target)) toggleLayouts(false)
  }

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || document.querySelector('.overlay')) return
    event.stopPropagation()
    toggleLayouts(false)
    this.anchor().focus()
  }

  private close(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    document.removeEventListener('keydown', this.onEscape, true)
    this.root?.remove()
    this.root = null
  }

  private render(state: AppState): void {
    if (!this.root) return
    const { layouts } = state.settings
    const signature = JSON.stringify([layouts, state.settings.projects.map((p) => [p.id, p.name]), state.panes.length])
    if (signature === this.signature) return
    this.signature = signature
    const hadFocus = this.root.contains(document.activeElement)
    this.root.replaceChildren(...this.content(state, layouts))
    if (!hadFocus) this.root.querySelector<HTMLElement>('.btn')?.focus()
  }

  private content(state: AppState, layouts: SavedLayout[]): HTMLElement[] {
    const example = layouts[0] ? layoutSlug(layouts[0].name) : 'morning'
    const head = h(
      'div',
      { class: 'layouts-head' },
      h('h2', { class: 'popover-title' }, 'Saved layouts'),
      h('span', { class: 'muted' }, `${layouts.length} saved`)
    )
    const list = h(
      'div',
      { class: 'layouts-list' },
      ...(layouts.length === 0
        ? [h('p', { class: 'popover-empty' }, 'No layouts yet. Arrange your panes, then save them to bring the same setup back later.')]
        : layouts.map((layout) => this.row(state, layout)))
    )
    const save = h(
      'button',
      {
        class: 'btn small primary',
        type: 'button',
        id: 'save-layout',
        disabled: state.panes.length === 0,
        onClick: () => {
          toggleLayouts(false)
          void saveCurrentLayout()
        }
      },
      'Save current layout…'
    )
    const foot = h(
      'div',
      { class: 'layouts-foot' },
      save,
      h('span', { class: 'muted' }, 'From a terminal: ', h('code', {}, `dawsha open ${example}`))
    )
    return [head, list, foot]
  }

  private row(state: AppState, layout: SavedLayout): HTMLElement {
    const slots = layout.panes.map((pane) => {
      const project = projectById(state, pane.projectId)
      return h(
        'span',
        { class: `layout-slot${project ? '' : ' missing'}` },
        agentMark(paneAgent(pane)),
        project?.name ?? 'removed project'
      )
    })
    const action = (label: string, run: () => void): HTMLElement =>
      h(
        'button',
        { class: 'btn small ghost', type: 'button', 'aria-label': `${label} layout ${layout.name}`, onClick: run },
        label
      )
    return h(
      'div',
      { class: 'layout-row', 'data-layout': layout.name },
      h(
        'div',
        { class: 'layout-main' },
        h('div', { class: 'layout-title' }, h('strong', {}, layout.name), h('span', { class: 'muted' }, paneCountText(layout.panes.length))),
        h('div', { class: 'layout-slots' }, ...slots)
      ),
      h(
        'div',
        { class: 'layout-actions' },
        action('Open', () => void openLayoutFromUi(layout)),
        action('Rename', () => {
          toggleLayouts(false)
          void renameLayout(layout.id)
        }),
        action('Delete', () => {
          toggleLayouts(false)
          void deleteLayout(layout.id)
        })
      )
    )
  }
}
