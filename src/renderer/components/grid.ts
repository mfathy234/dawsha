import { forgetStateClocks } from '../stateClock'
import { forgetSessionNotes } from '../sessionNotes'
import { forgetTimelineLogs } from '../timelineLog'
import { largeOf, openQuickPick, setSplits, showView } from '../actions'
import { OthersPanelComponent } from './othersPanel'
import { derivePanes, type PaneView } from '../derive'
import { clear, h } from '../dom'
import { pairOf } from '../../shared/compare'
import { sessionState } from '../../shared/sessionState'
import { layoutForCount, type GridLayout } from '../../shared/layout'
import { focusLayout, largeUnitIndex, promotedRows, quietPaneIds, SIDE_PANE_MIN_HEIGHT, sideColumnOverflows, tileLayout } from '../../shared/gridStyle'
import { equalSizes, resolveSplit, shapeKey, withSplit } from '../../shared/splits'
import type { CompareLink, GridSplit, GridSplits } from '../../shared/types'
import type { AppState } from '../state'
import { getTerminal } from '../terminals'
import { ComparePairComponent } from './comparePair'
import { GridGutters } from './gutters'
import { PaneComponent } from './pane'
import { SessionTabs } from './sessionTabs'
import { SidePanelComponent } from './sidePanel'

const MIN_ROW_HEIGHT = '340px'
const GRID_GAP = 12
const GRID_PADDING = 12
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
  private readonly tabs = new SessionTabs()
  private readonly empty = h('div', { class: 'empty' })
  private readonly others = new OthersPanelComponent()
  private readonly stage = h('div', { class: 'grid-stage' }, this.grid, this.others.el)
  private readonly sidePanel = new SidePanelComponent(() => this.stage)
  private readonly bg = h('div', { class: 'bg-layer', 'aria-hidden': 'true' })
  private readonly gutters = new GridGutters((axis, sizes) => this.resize(axis, sizes))
  private shape = { cols: 1, rows: 1, variant: '' }
  private lastFocused: string | null = null
  private splits: GridSplits = {}
  private panelMode = false
  private sideScroll = false
  private lastState: AppState | null = null

  constructor() {
    this.stage.append(this.sidePanel.el)
    this.el = h('div', { class: 'grid-area' }, this.bg, this.tabs.el, this.stage, this.gutters.el, this.empty)
    new ResizeObserver(() => {
      this.gutters.position()
      if (this.lastState && this.sideScroll !== this.sideColumnScrolls(this.lastState)) this.update(this.lastState)
    }).observe(this.grid)
  }

  private resize(axis: 'cols' | 'rows', sizes: number[]): void {
    setSplits(withSplit(this.splits, this.shape.cols, this.shape.rows, axis, sizes, this.shape.variant))
  }

  update(state: AppState): void {
    this.lastState = state
    const views = derivePanes(state)
    // Unhide before panes mount so terminals measure a visible grid. When empty, a visible grid
    // would take half the height and push the empty-state message below center.
    this.stage.hidden = views.length === 0
    const units = unitsOf(views)
    this.syncPanes(views)
    const elements = this.syncUnits(units)
    const panel = state.view === 'grid' && state.settings.sessionsLayout === 'panel'
    const shownId = panel ? (views.some((v) => v.pane.id === state.focusedId) ? state.focusedId : (views[0]?.pane.id ?? null)) : state.maximizedId
    this.panelMode = panel
    const maximized = shownId !== null && views.some((v) => v.pane.id === shownId)
    this.splits = state.splits
    // The large unit is not always the focused one: see resolveLargePane.
    const focusUnit = largeUnitIndex(units.map(paneIds), largeOf(state))
    this.layout(units, elements, views, state, maximized ? shownId : null, focusUnit)
    const quiet = this.quietPanes(units, state, focusUnit, maximized)
    for (const view of views) {
      const isMax = maximized && view.pane.id === shownId
      this.panes.get(view.pane.id)?.update(view, view.pane.id === state.focusedId, isMax, quiet.has(view.pane.id))
    }
    this.tabs.update(views, state, maximized, shownId)
    this.sidePanel.update(state, views.find((view) => view.pane.id === shownId) ?? null, panel && maximized)
    const visible = new Set(views.filter((view) => this.panes.get(view.pane.id)?.el.hidden === false).map((view) => view.pane.id))
    this.others.update(state, views, visible, maximized && !panel)
    this.updateEmpty(state, views.length)
    this.restoreFocus(state)
  }

  private syncPanes(views: PaneView[]): void {
    const ids = new Set(views.map((v) => v.pane.id))
    forgetStateClocks(ids)
    forgetSessionNotes(ids)
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

  private layout(units: Unit[], elements: HTMLElement[], views: PaneView[], state: AppState, maximizedId: string | null, focusUnit: number): void {
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
    const tiles = units.length > 1 && state.settings.gridStyle === 'tiles'
    this.grid.classList.toggle('tiles', tiles)
    this.grid.classList.toggle('focus-style', units.length > 1 && !tiles)
    const layout = this.planLayout(units.length, tiles, focusUnit)
    const split = tiles ? { cols: equalSizes(layout.cols), rows: equalSizes(layout.rows) } : this.focusSplit(layout, units, views, focusUnit)
    const track = (sizes: number[]): string => sizes.map((size) => `minmax(0, ${size}fr)`).join(' ')
    const sideTrack = (sizes: number[]): string => sizes.map((size) => `minmax(${SIDE_PANE_MIN_HEIGHT}px, ${size}fr)`).join(' ')
    const focusStyle = units.length > 1 && !tiles
    this.sideScroll = focusStyle && this.sideColumnScrolls(state)
    style.gridTemplateColumns = track(split.cols)
    style.gridTemplateRows = layout.scrolls ? `repeat(${layout.rows}, minmax(${MIN_ROW_HEIGHT}, 1fr))` : focusStyle ? sideTrack(split.rows) : track(split.rows)
    style.setProperty('--grid-h', `${Math.max(0, this.grid.clientHeight - GRID_PADDING * 2)}px`)
    this.grid.classList.toggle('scrolls', layout.scrolls)
    this.grid.classList.toggle('side-scroll', this.sideScroll)
    const spanned = new Set<number>()
    elements.forEach((element, index) => {
      const cell = layout.cells[index]
      if (!cell) return
      element.hidden = false
      element.classList.remove('solo')
      element.classList.toggle('focus-sticky', this.sideScroll && index === focusUnit)
      element.style.gridColumn = `${cell.col} / span ${cell.colSpan}`
      element.style.gridRow = `${cell.row} / span ${cell.rowSpan}`
      for (let boundary = cell.col; boundary < cell.col + cell.colSpan - 1; boundary += 1) spanned.add(boundary - 1)
    })
    this.shape = { cols: layout.cols, rows: layout.rows, variant: layout.variant }
    this.gutters.update({
      grid: this.grid,
      enabled: !layout.scrolls && !this.sideScroll && units.length > 1 && !tiles,
      cols: layout.cols,
      rows: layout.rows,
      rowsFrom: layout.rowsFrom,
      variant: layout.variant,
      sizes: split,
      spanned
    })
  }

  /** In Calm focus the side column keeps each pane at least its minimum height and scrolls when they do not all fit. */
  private sideColumnScrolls(state: AppState): boolean {
    if (state.settings.gridStyle !== 'focus' || this.grid.classList.contains('maximized')) return false
    const siblings = this.grid.children.length - 1
    return sideColumnOverflows(siblings, this.grid.clientHeight, GRID_GAP, GRID_PADDING)
  }

  private planLayout(count: number, tiles: boolean, focusUnit: number): GridLayout {
    if (count <= 1) return layoutForCount(count)
    return tiles ? tileLayout(count) : focusLayout(count, focusUnit)
  }

  /** The focus column's split; a sibling that needs you is taller until the user drags a row gutter. */
  private focusSplit(layout: GridLayout, units: Unit[], views: PaneView[], focusUnit: number): GridSplit {
    const split = resolveSplit(this.splits, layout.cols, layout.rows, layout.variant)
    if (units.length < 2 || this.splits[shapeKey(layout.cols, layout.rows, layout.variant)]) return split
    const needs = units.filter((_, index) => index !== focusUnit).map((unit) => this.unitNeeds(unit, views))
    return { ...split, rows: promotedRows(layout.rows, needs) }
  }

  private unitNeeds(unit: Unit, views: PaneView[]): boolean {
    return paneIds(unit).some((id) => {
      const view = views.find((candidate) => candidate.pane.id === id)
      return view !== undefined && sessionState({ status: view.status, attention: view.attention }) === 'needs'
    })
  }

  /** In calm focus every sibling is quiet unless you are working in it; mission control tiles are all equal. */
  private quietPanes(units: Unit[], state: AppState, focusUnit: number, maximized: boolean): Set<string> {
    if (maximized || state.settings.gridStyle !== 'focus' || units.length < 2) return new Set()
    return quietPaneIds(units.map(paneIds), focusUnit, state.focusedId)
  }

  private layoutMaximized(units: Unit[], elements: HTMLElement[], views: PaneView[], maximizedId: string): void {
    const style = this.grid.style
    const pinnedId = this.panelMode ? undefined : views.find((view) => view.pane.pinned === true)?.pane.id
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
    this.sideScroll = false
    this.grid.classList.remove('side-scroll')
    this.grid.classList.toggle('with-pinned', sideIndex >= 0)
    style.gridTemplateColumns = sideIndex >= 0 ? `minmax(0, 1fr) ${PINNED_WIDTH}` : 'minmax(0, 1fr)'
    style.gridTemplateRows = 'minmax(0, 1fr)'
    this.grid.classList.remove('scrolls')
    units.forEach((unit, index) => {
      const contains = paneIds(unit).includes(maximizedId)
      const element = elements[index]
      const side = index === sideIndex
      element.hidden = !contains && !side
      element.classList.remove('focus-sticky')
      element.classList.toggle('solo', contains && unit.kind === 'pair')
      element.style.gridColumn = side ? '2' : '1'
      element.style.gridRow = '1'
    })
    this.gutters.update({
      grid: this.grid,
      enabled: false,
      cols: 1,
      rows: 1,
      rowsFrom: 0,
      variant: '',
      sizes: { cols: [1], rows: [1] },
      spanned: new Set()
    })
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
    if (!pane || state.view !== 'grid' || state.settings.sessionsLayout === 'board' || state.quickPickOpen || document.querySelector('.overlay:not(.leaving)')) return
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      if (!active.classList.contains('xterm-helper-textarea')) return
    }
    getTerminal(pane.activeTabId)?.focus()
  }
}
