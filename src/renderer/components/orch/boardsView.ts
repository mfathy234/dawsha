import { selectMenu, syncSelectMenu } from '../selectMenu'
import {
  boardCards,
  DEFAULT_BOARD_FILTER,
  groupByColumn,
  modelName,
  projectTabs,
  type BoardCard,
  type BoardFilter,
  type StatusFilter
} from '../../../shared/orch/board'
import { ORCH_ROLES } from '../../../shared/orch/types'
import { clear, h } from '../../dom'
import { showOrch } from '../../orchActions'
import type { AppState } from '../../state'
import { modelBadge, ROLE_LABEL, STATUS_LABEL } from './orchUi'
import './boardsView.css'

export interface TaskBoardOptions {
  /** Small project chip on every card (the "All projects" board). */
  showProject: boolean
  /** Short run tag on every card; off inside one run's dashboard. */
  showRun: boolean
  onOpen: (card: BoardCard) => void
  /** Highlights the card whose key matches. */
  selectedKey?: string | null
  emptyText?: string
}

function cardMeta(card: BoardCard, options: TaskBoardOptions): HTMLElement {
  const badge = card.agent
    ? modelBadge(card.agent.runner, card.agent.model, ROLE_LABEL[card.agent.role])
    : h('span', { class: 'orch-card-role' }, ROLE_LABEL[card.role])
  const extras = [card.reviewRound > 0 ? `round ${card.reviewRound}` : '', card.attempts > 0 ? `${card.attempts} ${card.attempts === 1 ? 'attempt' : 'attempts'}` : ''].filter(Boolean)
  return h(
    'div',
    { class: 'orch-card-meta' },
    options.showProject && card.projectName ? h('span', { class: 'orch-chip', title: `Project ${card.projectName}` }, card.projectName) : null,
    badge,
    ...extras.map((text) => h('span', { class: 'orch-card-extra' }, text))
  )
}

function taskCard(card: BoardCard, options: TaskBoardOptions): HTMLElement {
  const selected = options.selectedKey === card.key
  return h(
    'button',
    {
      class: `orch-card${card.column === 'needs' ? ' needs' : ''}${selected ? ' selected' : ''}`,
      type: 'button',
      'aria-pressed': options.selectedKey === undefined ? undefined : String(selected),
      title: `${card.key} · ${STATUS_LABEL[card.status]} · ${card.runTitle}`,
      onClick: () => options.onOpen(card)
    },
    h('span', { class: 'orch-card-id' }, h('span', { class: 'orch-mono' }, card.key), options.showRun ? h('span', { class: 'orch-run-tag' }, card.runTag) : null),
    h('span', { class: 'orch-card-title' }, card.title),
    cardMeta(card, options)
  )
}

/** The five-column kanban used by the Boards tab and by a run's dashboard. */
export function renderTaskBoard(cards: readonly BoardCard[], options: TaskBoardOptions): HTMLElement {
  if (cards.length === 0) return h('div', { class: 'orch-board-empty' }, options.emptyText ?? 'No tasks match.')
  const columns = groupByColumn(cards).map((column) =>
    h(
      'section',
      { class: `orch-col${column.id === 'needs' ? ' needs' : ''}`, 'aria-label': `${column.label}, ${column.cards.length} tasks` },
      h('header', { class: 'orch-col-head' }, column.label, h('span', { class: 'orch-col-count' }, String(column.cards.length))),
      h('div', { class: 'orch-col-cards' }, ...column.cards.map((card) => taskCard(card, options)))
    )
  )
  return h('div', { class: 'orch-board' }, ...columns)
}

interface SelectOption {
  value: string
  label: string
}

class FilterSelect {
  readonly el: HTMLElement
  private readonly select: HTMLSelectElement
  private signature = ''

  constructor(label: string, onChange: (value: string) => void) {
    this.select = h('select', { class: 'orch-select', 'aria-label': label })
    this.select.addEventListener('change', () => onChange(this.select.value))
    this.el = h('div', { class: 'orch-filter' }, h('span', { class: 'orch-filter-label' }, label), selectMenu(this.select))
  }

  /** Returns false when the current value is no longer offered. */
  set(options: readonly SelectOption[], value: string): boolean {
    const signature = options.map((o) => `${o.value}\u0001${o.label}`).join('\u0002')
    if (signature !== this.signature) {
      this.signature = signature
      clear(this.select)
      for (const option of options) this.select.append(h('option', { value: option.value }, option.label))
    }
    const present = options.some((o) => o.value === value)
    this.select.value = present ? value : (options[0]?.value ?? '')
    syncSelectMenu(this.select)
    return present
  }
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Done' }
]

/** Boards: project tabs, filters and one kanban of the tasks from every run. */
export class OrchBoardsView {
  readonly el = h('section', { class: 'orch-section orch-boards' })
  private readonly tabs = h('div', { class: 'orch-projtabs', role: 'tablist', 'aria-label': 'Projects' })
  private readonly boardHost = h('div', { class: 'orch-board-host' })
  private readonly summary = h('div', { class: 'orch-boards-note orch-muted' })
  private readonly search = h('input', { class: 'orch-search', type: 'search', placeholder: 'Search titles, specs, feedback…', id: 'orch-board-search' })
  private readonly runSelect = new FilterSelect('Run', (value) => this.setFilter({ runId: value }))
  private readonly statusSelect = new FilterSelect('Status', (value) => this.setFilter({ status: value as StatusFilter }))
  private readonly roleSelect = new FilterSelect('Role', (value) => this.setFilter({ role: value }))
  private readonly modelSelect = new FilterSelect('Model', (value) => this.setFilter({ model: value }))
  private readonly needsToggle = this.toggle('Needs you only', (on) => this.setFilter({ needsOnly: on }))
  private readonly finishedToggle = this.toggle('Include finished runs', (on) => this.setFilter({ includeFinished: on }))
  private filter: BoardFilter = DEFAULT_BOARD_FILTER
  private state: AppState | null = null
  private signature = ''

  constructor() {
    this.search.addEventListener('input', () => this.setFilter({ query: this.search.value }))
    const searchLabel = h('label', { class: 'orch-filter orch-filter-search', for: 'orch-board-search' }, h('span', { class: 'orch-filter-label' }, 'Search'), this.search)
    const bar = h('div', { class: 'orch-filterbar' }, searchLabel, this.runSelect.el, this.statusSelect.el, this.roleSelect.el, this.modelSelect.el, this.needsToggle.el, this.finishedToggle.el)
    this.el.append(this.tabs, h('div', { class: 'orch-panel orch-boards-panel' }, bar, this.boardHost), this.summary)
  }

  update(state: AppState): void {
    this.state = state
    const runs = state.orch?.runs ?? []
    const projects = state.settings.projects
    const tabs = projectTabs(runs, projects)
    if (!tabs.some((t) => t.id === this.filter.projectId)) this.filter = { ...this.filter, projectId: '' }
    const cards = boardCards(runs, projects, this.filter)
    const signature = JSON.stringify([tabs, cards.map((c) => [c.id, c.status, c.title, c.agent, c.reviewRound, c.attempts, c.runTag, c.projectName]), this.filter, runs.map((r) => [r.id, r.title, r.projectId, r.stage])])
    if (signature === this.signature) return
    this.signature = signature
    this.renderTabs(tabs)
    this.syncFilters(state)
    this.renderBoard(cards)
  }

  private toggle(label: string, onChange: (on: boolean) => void): { el: HTMLElement; set: (on: boolean) => void } {
    const input = h('input', { type: 'checkbox', class: 'orch-toggle-input' })
    input.addEventListener('change', () => onChange(input.checked))
    return { el: h('label', { class: 'orch-toggle' }, input, h('span', {}, label)), set: (on) => (input.checked = on) }
  }

  private setFilter(change: Partial<BoardFilter>): void {
    this.filter = { ...this.filter, ...change }
    this.signature = ''
    if (this.state) this.update(this.state)
  }

  private renderTabs(tabs: ReturnType<typeof projectTabs>): void {
    clear(this.tabs)
    for (const tab of tabs) {
      const selected = tab.id === this.filter.projectId
      this.tabs.append(
        h(
          'button',
          { class: 'orch-projtab', type: 'button', role: 'tab', 'aria-selected': String(selected), onClick: () => this.setFilter({ projectId: tab.id, runId: '' }) },
          tab.label,
          h('span', { class: 'orch-col-count' }, String(tab.count))
        )
      )
    }
  }

  private syncFilters(state: AppState): void {
    const runs = (state.orch?.runs ?? []).filter((r) => !this.filter.projectId || r.projectId === this.filter.projectId)
    const runOptions = [{ value: '', label: 'All' }, ...runs.map((r) => ({ value: r.id, label: r.title }))]
    if (!this.runSelect.set(runOptions, this.filter.runId)) this.filter = { ...this.filter, runId: '' }
    this.statusSelect.set(STATUS_OPTIONS, this.filter.status)
    const roles = [{ value: '', label: 'All' }, ...ORCH_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]
    this.roleSelect.set(roles, this.filter.role)
    const models = [...new Set((state.orch?.runs ?? []).flatMap((r) => r.agents.map((a) => modelName(a.runner, a.model))))].sort()
    if (!this.modelSelect.set([{ value: '', label: 'All' }, ...models.map((m) => ({ value: m, label: m }))], this.filter.model)) this.filter = { ...this.filter, model: '' }
    this.needsToggle.set(this.filter.needsOnly)
    this.finishedToggle.set(this.filter.includeFinished)
    if (this.search.value !== this.filter.query) this.search.value = this.filter.query
  }

  private renderBoard(cards: readonly BoardCard[]): void {
    clear(this.boardHost)
    const hasRuns = (this.state?.orch?.runs.length ?? 0) > 0
    const hiddenDone = this.filter.status === 'open' || !this.filter.includeFinished
    const emptyText = !hasRuns
      ? 'No runs yet. Start one from New run and its tasks show up here.'
      : hiddenDone
        ? 'No open tasks match these filters. Done tasks and finished runs are hidden: set Status to All and tick Include finished runs to see them.'
        : 'No tasks match these filters.'
    this.boardHost.append(renderTaskBoard(cards, { showProject: this.filter.projectId === '', showRun: true, onOpen: (card) => showOrch('runs', card.runId), emptyText }))
    this.summary.textContent = 'Each card carries its run tag. Click a card to open its run. Finished runs are hidden unless you include them.'
  }
}
