import { openQuickPick } from '../actions'
import { closePeek, closeReviewed, markReviewed } from '../boardActions'
import { derivePanes, type PaneView } from '../derive'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { AGENTS, AGENT_NAMES } from '../../shared/agents'
import { BOARD_COLUMNS, BOARD_EMPTY_HINT, BOARD_EMPTY_TEXT, canDropOn, groupByColumn, matchesBoardFilter, type BoardColumn, type BoardFilter } from '../../shared/board'
import { sessionState } from '../../shared/sessionState'
import type { AppState } from '../state'
import { BoardCard, drag, type BoardEntry } from './boardCard'
import { BoardPeek } from './boardPeek'
import { FilterMenu } from './filterMenu'
import { stateIcon } from './stateIcon'
import './pages.css'

const PREVIEW_MS = 1500

interface Column {
  id: BoardColumn
  el: HTMLElement
  body: HTMLElement
  count: HTMLElement
  empty: HTMLElement
  closeAll: HTMLButtonElement | null
}

function columnIcon(id: BoardColumn): HTMLElement {
  return id === 'reviewed' ? icon(ICONS.check) : stateIcon(id)
}

/** The sessions board: one column per stage, cards keyed by pane and updated in place. */
export class BoardComponent {
  readonly el = h('main', { class: 'board-view', 'aria-label': 'Sessions board', hidden: true })
  private readonly cards = new Map<string, BoardCard>()
  private readonly columns = new Map<BoardColumn, Column>()
  private readonly peek = new BoardPeek()
  private readonly projectFilter = new FilterMenu({ name: 'Project', onChange: () => this.rerender() })
  private readonly agentFilter = new FilterMenu({ name: 'Agent', onChange: () => this.rerender() })
  private optionsSignature = ''
  private state: AppState | null = null
  private timer: number | null = null
  private reviewedIds: string[] = []

  constructor() {
    const columns = h('div', { class: 'board-columns' })
    for (const { id, label } of BOARD_COLUMNS) {
      const column = this.buildColumn(id, label)
      this.columns.set(id, column)
      columns.append(column.el)
    }
    columns.addEventListener('keydown', (event) => this.onKey(event))
    const filters = h(
      'div',
      { class: 'board-filters' },
      this.projectFilter.el,
      this.agentFilter.el,
      h('span', { class: 'board-spacer' }),
      h('span', { class: 'board-hint' }, 'Cards move by themselves as sessions change. Drag a Done card to Reviewed.')
    )
    this.el.append(h('div', { class: 'board-main' }, filters, columns), this.peek.el)
  }

  update(state: AppState, showing: boolean): void {
    this.state = state
    this.el.hidden = !showing
    this.syncTimer(showing)
    const views = derivePanes(state)
    const peeked = state.boardPeekId ? views.find((view) => view.pane.id === state.boardPeekId) : undefined
    if (state.boardPeekId !== null && !peeked) queueMicrotask(closePeek)
    this.peek.update(showing ? (peeked ?? null) : null)
    if (!showing) {
      // Close any open filter menu so it does not float over the grid.
      this.projectFilter.dispose()
      this.agentFilter.dispose()
      return
    }
    this.syncOptions(state, views)
    this.render(views)
  }

  private rerender(): void {
    if (this.state) this.render(derivePanes(this.state))
  }

  private filter(): BoardFilter {
    return { projectId: this.projectFilter.value || null, agent: (this.agentFilter.value || null) as BoardFilter['agent'] }
  }

  private syncOptions(state: AppState, views: PaneView[]): void {
    const projects = state.settings.projects.map((project) => ({ value: project.id, label: project.name }))
    const extra = views.filter((view) => view.project && !projects.some((p) => p.value === view.project?.id)).map((view) => ({ value: view.project?.id ?? '', label: view.project?.name ?? '' }))
    const all = [...projects, ...extra.filter((p, i) => extra.findIndex((q) => q.value === p.value) === i)]
    const signature = JSON.stringify(all)
    if (signature === this.optionsSignature) return
    this.optionsSignature = signature
    this.projectFilter.setOptions([{ value: '', label: 'All projects' }, ...all])
    this.agentFilter.setOptions([{ value: '', label: 'All agents' }, ...AGENTS.map((agent) => ({ value: agent, label: AGENT_NAMES[agent], agent }))])
  }

  private render(views: PaneView[]): void {
    const filter = this.filter()
    const entries: BoardEntry[] = views
      .filter((view) => matchesBoardFilter({ projectId: view.pane.projectId, agent: view.agent }, filter))
      .map((view) => ({ view, state: sessionState(view) }))
    const groups = groupByColumn(entries)
    const live = new Set(entries.map((entry) => entry.view.pane.id))
    for (const [id, card] of this.cards) {
      if (live.has(id)) continue
      card.el.remove()
      this.cards.delete(id)
    }
    for (const { id } of BOARD_COLUMNS) this.renderColumn(this.columns.get(id) as Column, groups[id], id)
    this.reviewedIds = groups.reviewed.map((entry) => entry.view.pane.id)
  }

  private renderColumn(column: Column, entries: BoardEntry[], id: BoardColumn): void {
    const focused = document.activeElement
    const elements = entries.map((entry) => {
      const paneId = entry.view.pane.id
      let card = this.cards.get(paneId)
      if (!card) {
        card = new BoardCard(entry)
        this.cards.set(paneId, card)
      }
      card.update(entry, id)
      card.el.classList.toggle('peeking', paneId === this.state?.boardPeekId)
      return card.el
    })
    elements.forEach((element, position) => {
      if (column.body.children[position] === element) return
      const hadFocus = element === focused || element.contains(focused)
      column.body.insertBefore(element, column.body.children[position] ?? null)
      if (hadFocus) element.focus()
    })
    for (const child of [...column.body.children].slice(elements.length)) if (child !== column.empty) child.remove()
    if (column.body.lastElementChild !== column.empty) column.body.append(column.empty)
    column.empty.hidden = elements.length > 0
    const count = String(elements.length)
    if (column.count.textContent !== count) column.count.textContent = count
    column.el.setAttribute('aria-label', `${BOARD_COLUMNS.find((c) => c.id === id)?.label}, ${count}`)
    if (column.closeAll) column.closeAll.hidden = elements.length === 0
  }

  private buildColumn(id: BoardColumn, label: string): Column {
    const count = h('span', { class: 'board-count' }, '0')
    const empty = h(
      'div',
      { class: 'board-empty' },
      h('p', { class: 'board-empty-title' }, BOARD_EMPTY_TEXT[id]),
      h('p', { class: 'board-empty-hint' }, BOARD_EMPTY_HINT[id]),
      id === 'working' ? h('button', { class: 'btn small', type: 'button', onClick: () => openQuickPick() }, 'New session') : null
    )
    const body = h('div', { class: 'board-col-body' }, empty)
    const closeAll =
      id === 'reviewed'
        ? h('button', { class: 'link-quiet', type: 'button', 'aria-label': 'Close all reviewed sessions', onClick: () => void closeReviewed(this.reviewedIds) }, 'Close all…')
        : null
    const head = h('div', { class: 'board-col-head' }, columnIcon(id), h('span', { class: 'board-col-title' }, label), count, h('span', { class: 'board-spacer' }), closeAll)
    const foot = id === 'reviewed' ? h('button', { class: 'board-new', type: 'button', onClick: () => openQuickPick() }, '+ New session') : null
    const el = h('section', { class: `board-col board-col-${id}`, 'data-column': id }, head, body, foot)
    if (id === 'reviewed') this.acceptDrops(el)
    return { id, el, body, count, empty, closeAll }
  }

  private acceptDrops(target: HTMLElement): void {
    const allowed = (): boolean => drag.source !== null && canDropOn(drag.source.column, 'reviewed')
    target.addEventListener('dragover', (event) => {
      if (!allowed()) return
      event.preventDefault()
      target.classList.add('drop-target')
    })
    target.addEventListener('dragleave', (event) => {
      if (!target.contains(event.relatedTarget as Node | null)) target.classList.remove('drop-target')
    })
    target.addEventListener('drop', (event) => {
      target.classList.remove('drop-target')
      if (!allowed() || !drag.source) return
      event.preventDefault()
      markReviewed(drag.source.paneId)
      drag.source = null
    })
  }

  private onKey(event: KeyboardEvent): void {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.board-card')
    if (!card || event.target !== card) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      card.click()
      return
    }
    const next = this.neighbour(card, event.key)
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  private neighbour(card: HTMLElement, key: string): HTMLElement | null {
    const column = card.closest<HTMLElement>('.board-col')
    if (!column) return null
    const siblings = [...column.querySelectorAll<HTMLElement>('.board-card')]
    const index = siblings.indexOf(card)
    if (key === 'ArrowDown') return siblings[index + 1] ?? null
    if (key === 'ArrowUp') return siblings[index - 1] ?? null
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
    const step = key === 'ArrowRight' ? 1 : -1
    const columns = [...this.el.querySelectorAll<HTMLElement>('.board-col')]
    for (let at = columns.indexOf(column) + step; at >= 0 && at < columns.length; at += step) {
      const cards = columns[at].querySelectorAll<HTMLElement>('.board-card')
      if (cards.length > 0) return cards[Math.min(index, cards.length - 1)]
    }
    return null
  }

  private syncTimer(running: boolean): void {
    if (running && this.timer === null) {
      this.timer = window.setInterval(() => this.cards.forEach((card) => card.refreshPreview()), PREVIEW_MS)
    } else if (!running && this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }
}
