import { forgetStateClocks } from '../stateClock'
import { forgetTimelineLogs } from '../timelineLog'
import { closePane, focusPane, openQuickPick, setSplits, showView } from '../actions'
import { OthersPanelComponent } from './othersPanel'
import { derivePanes, type PaneView } from '../derive'
import { clear, h, iconButton } from '../dom'
import { ICONS } from '../icons'
import { pairOf } from '../../shared/compare'
import { layoutForCount } from '../../shared/layout'
import { resolveSplit, withSplit } from '../../shared/splits'
import type { CompareLink, GridSplits } from '../../shared/types'
import type { AppState } from '../state'
import { getTerminal } from '../terminals'
import { agentMark } from './agentMark'
import { ComparePairComponent } from './comparePair'
import { GridGutters } from './gutters'
import { PaneComponent } from './pane'

const MIN_ROW_HEIGHT = '340px'
const PINNED_WIDTH = '32%'

type Unit =
  | { kind: 'pane'; view: PaneView }
  | { kind: 'pair'; link: CompareLink; a: PaneView; b: PaneView }

function unitsOf(views: PaneView[]): Unit[] {
  const units: Unit[] = []
  const compared = views.map((view) => ({ compare: view.pane.compare, view }))
  for (let index = 0; index < views.length; index += 1) {
    const pair = pairOf(compared, index)
    if (pair) {
      units.push({ kind: 'pair', link: pair.link, a: pair.a.view, b: pair.b.view })
      index += 1
    } else {
      units.push({ kind: 'pane', view: views[index] })
    }
  }
  return units
}

const paneIds = (unit: Unit): string[] => (unit.kind === 'pane' ? [unit.view.pane.id] : [unit.a.pane.id, unit.b.pane.id])

export class GridComponent {
  readonly el: HTMLElement
  private readonly panes = new Map<string, PaneComponent>()
  private readonly pairs = new Map<string, ComparePairComponent>()
  private readonly grid = h('div', { class: 'grid' })
  private readonly strip = h('div', { class: 'pane-strip', role: 'tablist', 'aria-label': 'Sessions' })
  private readonly empty = h('div', { class: 'empty' })
  private readonly others = new OthersPanelComponent()
  private readonly stage = h('div', { class: 'grid-stage' }, this.grid, this.others.el)
  private readonly bg = h('div', { class: 'bg-layer', 'aria-hidden': 'true' })
  private readonly gutters = new GridGutters((axis, sizes) => this.resize(axis, sizes))
  private shape = { cols: 1, rows: 1 }
  private lastFocused: string | null = null
  private stripSignature = ''
  private splits: GridSplits = {}

  constructor() {
    this.el = h('div', { class: 'grid-area' }, this.bg, this.strip, this.stage, this.gutters.el, this.empty)
    new ResizeObserver(() => this.gutters.position()).observe(this.grid)
  }

  private resize(axis: 'cols' | 'rows', sizes: number[]): void {
    setSplits(withSplit(this.splits, this.shape.cols, this.shape.rows, axis, sizes))
  }

  update(state: AppState): void {
    const views = derivePanes(state)
    // Unhide before panes mount so terminals measure a visible grid. When empty, a visible grid
    // would take half the height and push the empty-state message below center.
    this.stage.hidden = views.length === 0
    const units = unitsOf(views)
    this.syncPanes(views)
    const elements = this.syncUnits(units)
    const maximized = state.maximizedId !== null && views.some((v) => v.pane.id === state.maximizedId)
    this.splits = state.splits
    this.layout(units, elements, views, maximized ? state.maximizedId : null)
    for (const view of views) {
      const isMax = maximized && view.pane.id === state.maximizedId
      this.panes.get(view.pane.id)?.update(view, view.pane.id === state.focusedId, isMax)
    }
    this.updateStrip(views, state, maximized)
    const visible = new Set(views.filter((view) => this.panes.get(view.pane.id)?.el.hidden === false).map((view) => view.pane.id))
    this.others.update(state, views, visible, maximized)
    this.updateEmpty(state, views.length)
    this.restoreFocus(state)
  }

  private syncPanes(views: PaneView[]): void {
    const ids = new Set(views.map((v) => v.pane.id))
    forgetStateClocks(ids)
    forgetTimelineLogs(ids)
    for (const [id, component] of this.panes) {
      if (!ids.has(id)) {
        component.dispose()
        this.panes.delete(id)
      }
    }
    for (const view of views) {
      if (!this.panes.has(view.pane.id)) this.panes.set(view.pane.id, new PaneComponent(view.pane.id))
    }
  }

  private syncUnits(units: Unit[]): HTMLElement[] {
    const live = new Set(units.flatMap((unit) => (unit.kind === 'pair' ? [unit.link.id] : [])))
    for (const [id, pair] of this.pairs) {
      if (!live.has(id)) {
        pair.dispose()
        this.pairs.delete(id)
      }
    }
    const elements = units.map((unit) => this.unitElement(unit))
    elements.forEach((element, position) => {
      if (this.grid.children[position] !== element) this.grid.insertBefore(element, this.grid.children[position] ?? null)
    })
    while (this.grid.children.length > elements.length) this.grid.lastElementChild?.remove()
    return elements
  }

  private unitElement(unit: Unit): HTMLElement {
    if (unit.kind === 'pane') return this.panes.get(unit.view.pane.id)?.el ?? h('div')
    let pair = this.pairs.get(unit.link.id)
    if (!pair) {
      pair = new ComparePairComponent()
      this.pairs.set(unit.link.id, pair)
    }
    pair.update(unit.link, unit.a.project?.name ?? '')
    const first = this.panes.get(unit.a.pane.id)?.el
    const second = this.panes.get(unit.b.pane.id)?.el
    if (first && first.parentElement !== pair.slotA) pair.slotA.append(first)
    if (second && second.parentElement !== pair.slotB) pair.slotB.append(second)
    return pair.el
  }

  private layout(units: Unit[], elements: HTMLElement[], views: PaneView[], maximizedId: string | null): void {
    const style = this.grid.style
    this.grid.classList.toggle('maximized', maximizedId !== null)
    this.el.classList.toggle('focus-view', maximizedId !== null)
    if (maximizedId !== null) {
      this.layoutMaximized(units, elements, views, maximizedId)
      return
    }
    for (const view of views) {
      const component = this.panes.get(view.pane.id)
      if (!component) continue
      component.el.hidden = false
      component.el.classList.remove('pinned-side')
    }
    this.grid.classList.remove('with-pinned')
    const layout = layoutForCount(units.length)
    const split = resolveSplit(this.splits, layout.cols, layout.rows)
    const track = (sizes: number[]): string => sizes.map((size) => `minmax(0, ${size}fr)`).join(' ')
    style.gridTemplateColumns = layout.scrolls ? `repeat(${layout.cols}, minmax(0, 1fr))` : track(split.cols)
    style.gridTemplateRows = layout.scrolls
      ? `repeat(${layout.rows}, minmax(${MIN_ROW_HEIGHT}, 1fr))`
      : track(split.rows)
    this.grid.classList.toggle('scrolls', layout.scrolls)
    const spanned = new Set<number>()
    elements.forEach((element, index) => {
      const cell = layout.cells[index]
      if (!cell) return
      element.hidden = false
      element.classList.remove('solo')
      element.style.gridColumn = `${cell.col} / span ${cell.colSpan}`
      element.style.gridRow = String(cell.row)
      for (let boundary = cell.col; boundary < cell.col + cell.colSpan - 1; boundary += 1) spanned.add(boundary - 1)
    })
    this.shape = { cols: layout.cols, rows: layout.rows }
    this.gutters.update({
      grid: this.grid,
      enabled: !layout.scrolls && units.length > 1,
      cols: layout.cols,
      rows: layout.rows,
      sizes: split,
      spanned
    })
  }

  private layoutMaximized(units: Unit[], elements: HTMLElement[], views: PaneView[], maximizedId: string): void {
    const style = this.grid.style
    const pinnedId = views.find((view) => view.pane.pinned === true)?.pane.id
    const sideIndex = pinnedId
      ? units.findIndex((unit) => paneIds(unit).includes(pinnedId) && !paneIds(unit).includes(maximizedId))
      : -1
    const sideIds = sideIndex >= 0 ? paneIds(units[sideIndex]) : []
    for (const view of views) {
      const component = this.panes.get(view.pane.id)
      if (!component) continue
      const side = sideIds.includes(view.pane.id)
      component.el.hidden = view.pane.id !== maximizedId && !side
      component.el.classList.toggle('pinned-side', side)
    }
    this.grid.classList.toggle('with-pinned', sideIndex >= 0)
    style.gridTemplateColumns = sideIndex >= 0 ? `minmax(0, 1fr) ${PINNED_WIDTH}` : 'minmax(0, 1fr)'
    style.gridTemplateRows = 'minmax(0, 1fr)'
    this.grid.classList.remove('scrolls')
    units.forEach((unit, index) => {
      const contains = paneIds(unit).includes(maximizedId)
      const element = elements[index]
      const side = index === sideIndex
      element.hidden = !contains && !side
      element.classList.toggle('solo', contains && unit.kind === 'pair')
      element.style.gridColumn = side ? '2' : '1'
      element.style.gridRow = '1'
    })
    this.gutters.update({
      grid: this.grid,
      enabled: false,
      cols: 1,
      rows: 1,
      sizes: { cols: [1], rows: [1] },
      spanned: new Set()
    })
  }

  private updateStrip(views: PaneView[], state: AppState, maximized: boolean): void {
    this.strip.hidden = !maximized
    if (!maximized) return
    const signature = JSON.stringify([views.map((v) => [v.pane.id, v.title, v.status, v.agent]), state.focusedId])
    if (signature === this.stripSignature) return
    this.stripSignature = signature
    clear(this.strip)
    for (const view of views) this.strip.append(this.stripTab(view, view.pane.id === state.maximizedId))
    this.strip.querySelector('.strip-tab.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private stripTab(view: PaneView, selected: boolean): HTMLElement {
    const name = view.title
    const status = h('span', { class: `strip-status ${view.status}` }, ` · ${view.status}`)
    const label = h(
      'button',
      {
        class: 'strip-label',
        type: 'button',
        role: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        title: `${name} · ${view.status}`,
        onClick: () => focusPane(view.pane.id)
      },
      h('span', { class: 'strip-index' }, `${view.index + 1}`),
      agentMark(view.agent),
      h('bdi', { class: 'strip-name', dir: 'auto' }, name),
      status
    )
    const close = iconButton(`Close ${name}`, ICONS.closeSmall, () => void closePane(view.pane.id), 'strip-close')
    return h('div', { class: `strip-tab${selected ? ' selected' : ''}`, 'data-pane-id': view.pane.id }, label, close)
  }

  private updateEmpty(state: AppState, count: number): void {
    this.empty.hidden = count > 0
    if (count > 0) return
    clear(this.empty)
    const hasProjects = state.settings.projects.length > 0
    this.empty.append(
      h('h2', {}, hasProjects ? 'No sessions yet' : 'Add a project to get started'),
      h(
        'p',
        {},
        hasProjects
          ? navigator.platform.toLowerCase().includes('mac')
            ? 'Press Cmd+N or pick a project in the sidebar. Claude starts in its folder right away.'
            : 'Press Ctrl+N or pick a project in the sidebar. Claude starts in its folder right away.'
          : 'A project is a name and a folder. Starting a session opens Claude in that folder.'
      ),
      hasProjects
        ? h('button', { class: 'btn primary', type: 'button', onClick: () => openQuickPick() }, 'New session')
        : h('button', { class: 'btn primary', type: 'button', onClick: () => showView('projects') }, 'Add a project')
    )
  }

  private restoreFocus(state: AppState): void {
    if (state.focusedId === this.lastFocused) return
    this.lastFocused = state.focusedId
    const pane = state.panes.find((p) => p.id === state.focusedId)
    if (!pane || state.view !== 'grid' || state.settings.sessionsLayout === 'board' || state.quickPickOpen || document.querySelector('.overlay')) return
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      if (!active.classList.contains('xterm-helper-textarea')) return
    }
    getTerminal(pane.activeTabId)?.focus()
  }
}
