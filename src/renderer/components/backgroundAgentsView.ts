import {
  BG_RANGES, BG_STATUSES, DEFAULT_BG_FILTERS, STATUS_LABELS, applyFilters, axisTicks, axisWindow, barGeometry, barLabel, buildLanes, compactTokens, costLabel, filtersActive,
  projectOptions, spanLabel, statusCounts, toggleIn, totalsOf, type BackgroundAgent, type BgFilters, type BgKind, type BgLane, type BgRange, type BgStatus
} from '../../shared/backgroundAgents'
import { modelLabel } from '../../shared/sessionDetail'
import { AGENT_NAMES } from '../../shared/agents'
import { agentsFailed, agentsFilters, agentsReport, onAgentsChange, refreshAgents, setAgentFilters } from '../backgroundAgents'
import { findOpenSession, focusOpenSession, resumeInNewPane } from '../actions'
import { api } from '../api'
import { h } from '../dom'
import { store, type AppState } from '../state'
import { agentMark } from './agentMark'
import { selectMenu, syncSelectMenu } from './selectMenu'
import { toast } from './toast'
import './backgroundAgentsView.css'

const REFRESH_MS = 5000
const KIND_CHIPS: { kind: BgKind; label: string }[] = [{ kind: 'claude', label: 'Claude Code' }, { kind: 'codex', label: 'Codex' }]

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const stamp = (at: number): string => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const tickLabel = (at: number, range: BgRange): string => (range === '7d' ? new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric' }) : clock(at))
const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function makeSelect(id: string, label: string, onChange: (value: string) => void): HTMLSelectElement {
  return h('select', { id, 'aria-label': label, onChange: (event: Event) => onChange((event.target as HTMLSelectElement).value) })
}

export class BackgroundAgentsViewComponent {
  readonly el = h('main', { class: 'bg-view', 'aria-label': 'Background agents' })
  private visible = false
  private timer: number | undefined
  private selected: string | null = null
  private projects: readonly { id: string; name: string }[] = []
  private projectSignature = ''
  private readonly chips = h('div', { class: 'bg-chips', role: 'group', 'aria-label': 'Filter by status' })
  private readonly totals = h('span', { class: 'bg-chip bg-totals', id: 'bg-totals', role: 'status' })
  private readonly search = h('input', {
    class: 'text-input bg-search', id: 'bg-search', type: 'search', placeholder: 'Search agents…', 'aria-label': 'Search agents',
    onInput: (event: Event) => {
      if (!(event as InputEvent).isComposing) this.change({ query: (event.target as HTMLInputElement).value })
    }
  })
  private readonly kindChips = KIND_CHIPS.map(({ kind, label }) => h('button', {
    class: 'bg-chip', type: 'button', id: `bg-kind-${kind}`, 'aria-pressed': 'false', onClick: () => this.change({ kinds: toggleIn(agentsFilters().kinds, kind) })
  }, label))
  private readonly projectSelect = makeSelect('bg-project-filter', 'Filter by project', (value) => this.change({ project: value || null }))
  private readonly rangeSelect = makeSelect('bg-range', 'Time range', (value) => this.change({ range: value as BgRange }))
  private readonly automatic = h('input', { type: 'checkbox', id: 'bg-automatic', onChange: (event: Event) => this.change({ showAutomatic: (event.target as HTMLInputElement).checked }) })
  private readonly clear = h('button', { class: 'btn ghost small', type: 'button', id: 'bg-clear', onClick: () => this.clearFilters() }, 'Clear filters')
  private readonly body = h('div', { class: 'bg-body' })
  private readonly filtersBar: HTMLElement

  constructor() {
    this.rangeSelect.append(...BG_RANGES.map((range) => h('option', { value: range.value }, range.label)))
    this.filtersBar = h('div', { class: 'bg-filters', role: 'group', 'aria-label': 'Search and filters' },
      this.search,
      h('div', { class: 'bg-chips', role: 'group', 'aria-label': 'Filter by agent' }, ...this.kindChips),
      selectMenu(this.projectSelect),
      selectMenu(this.rangeSelect),
      h('label', { class: 'bg-check', for: 'bg-automatic' }, this.automatic, 'Show automatic reviews'),
      this.clear)
    this.el.append(
      h('div', { class: 'bg-head' }, h('h1', {}, 'Background agents'), this.chips, h('span', { class: 'spacer' }), this.totals),
      this.filtersBar,
      this.body)
    this.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.search.value) {
        event.preventDefault()
        event.stopPropagation()
        this.change({ query: '' })
      }
    })
    onAgentsChange(() => {
      if (this.visible) this.render()
    })
  }

  update(state: AppState): void {
    this.projects = state.settings.projects
    const visible = state.view === 'background'
    if (visible === this.visible) return
    this.visible = visible
    window.clearInterval(this.timer)
    if (!visible) return
    this.render()
    void refreshAgents()
    this.timer = window.setInterval(() => void refreshAgents(), REFRESH_MS)
  }

  private change(patch: Partial<BgFilters>): void {
    setAgentFilters({ ...agentsFilters(), ...patch })
  }

  private clearFilters(): void {
    this.selected = null
    setAgentFilters({ ...DEFAULT_BG_FILTERS })
    this.search.focus()
  }

  private syncControls(filters: BgFilters, agents: readonly BackgroundAgent[]): void {
    if (document.activeElement !== this.search && this.search.value !== filters.query) this.search.value = filters.query
    this.kindChips.forEach((chip, index) => chip.setAttribute('aria-pressed', String(filters.kinds.includes(KIND_CHIPS[index].kind))))
    this.automatic.checked = filters.showAutomatic
    this.clear.hidden = !filtersActive(filters)
    const options = projectOptions(agents, this.projects)
    if (filters.project && !options.some((option) => option.value === filters.project)) options.push({ value: filters.project, label: this.projects.find((p) => p.id === filters.project)?.name ?? 'Other folders' })
    const signature = JSON.stringify(options)
    if (signature !== this.projectSignature) {
      this.projectSignature = signature
      this.projectSelect.replaceChildren(h('option', { value: '' }, 'All projects'), ...options.map((option) => h('option', { value: option.value }, option.label)))
    }
    this.projectSelect.value = filters.project ?? ''
    this.rangeSelect.value = filters.range
    syncSelectMenu(this.projectSelect)
    syncSelectMenu(this.rangeSelect)
  }

  private statusChip(status: BgStatus, total: number, filters: BgFilters): HTMLElement {
    return h('button', {
      class: `bg-chip st-${status}`, type: 'button', id: `bg-status-${status}`, 'aria-pressed': String(filters.statuses.includes(status)),
      onClick: () => this.change({ statuses: toggleIn(agentsFilters().statuses, status) })
    }, h('span', { class: 'bg-dot', 'aria-hidden': 'true' }), `${total} ${STATUS_LABELS[status]}`)
  }

  private render(): void {
    const report = agentsReport()
    const filters = agentsFilters()
    const all = report?.agents ?? []
    this.syncControls(filters, all)
    const shown = applyFilters(all, filters)
    const counts = statusCounts(applyFilters(all, filters, 'status'))
    this.chips.replaceChildren(...BG_STATUSES.map((status) => this.statusChip(status, counts[status], filters)))
    const sums = totalsOf(shown)
    this.totals.textContent = `${sums.approx ? '~' : ''}${compactTokens(sums.tokens)} tokens${sums.costUsd === null ? '' : ` · ${costLabel(sums.costUsd)}`}`
    this.el.setAttribute('aria-busy', String(report === null && !agentsFailed()))
    const selected = shown.find((agent) => agent.key === this.selected) ?? null
    if (!selected) this.selected = null
    const content: (HTMLElement | null)[] = []
    if (agentsFailed() && !report) content.push(h('p', { class: 'field-error', role: 'alert' }, 'Could not read the agent transcripts. Try again in a moment.'))
    else if (!report) content.push(h('p', { class: 'bg-empty', role: 'status' }, 'Looking for background agents…'))
    else if (shown.length === 0) content.push(this.empty(all, filters))
    else content.push(this.board(shown, filters.range, report.generatedAt), selected ? this.details(selected) : null)
    this.body.className = `bg-body${selected ? ' has-details' : ''}`
    this.body.replaceChildren(...content.filter((node): node is HTMLElement => node !== null))
  }

  private empty(all: readonly BackgroundAgent[], filters: BgFilters): HTMLElement {
    const visibleBase = applyFilters(all, { ...DEFAULT_BG_FILTERS, range: filters.range, showAutomatic: filters.showAutomatic })
    const phrase = BG_RANGES.find((range) => range.value === filters.range)?.phrase ?? 'this range'
    if (visibleBase.length === 0) {
      const hidden = all.filter((agent) => agent.automatic).length
      return h('div', { class: 'bg-empty', id: 'bg-empty', role: 'status' },
        h('p', { class: 'bg-empty-title' }, `No background agents in ${phrase}`),
        h('p', { class: 'muted' }, 'They appear here when a Claude Code or Codex session starts agents.'),
        hidden > 0 ? h('p', { class: 'muted' }, `${count(hidden, 'automatic review')} hidden. Turn on Show automatic reviews to see them.`) : null)
    }
    return h('div', { class: 'bg-empty', id: 'bg-nomatch', role: 'status' },
      h('p', { class: 'bg-empty-title' }, 'No agents match these filters'),
      h('p', { class: 'muted' }, `Nothing in ${phrase} fits. Clear the filters to see every agent.`),
      h('button', { class: 'btn', type: 'button', id: 'bg-empty-clear', onClick: () => this.clearFilters() }, 'Clear filters'))
  }

  private board(agents: readonly BackgroundAgent[], range: BgRange, now: number): HTMLElement {
    const window = axisWindow(range, now)
    const lanes = buildLanes(agents)
    const ticks = axisTicks(window)
    const axis = h('div', { class: 'bg-axis', 'aria-hidden': 'true' },
      h('span', { class: 'bg-axis-head' }, 'Session'),
      h('div', { class: 'bg-ticks' }, ...ticks.map((tick) => h('span', { style: `left:${tick.pct}%` }, tickLabel(tick.at, range)))))
    const legend = h('div', { class: 'bg-legend' },
      ...(['running', 'done', 'failed'] as const).map((status) => h('span', { class: `st-${status}` }, h('span', { class: 'bg-dot' }), STATUS_LABELS[status])),
      h('span', { class: 'auto' }, h('span', { class: 'bg-dot' }), 'automatic review'),
      h('span', { class: 'spacer' }), h('span', {}, 'Select a bar for details. Arrow keys move between bars.'))
    const rows = lanes.map((lane) => this.lane(lane, window, now))
    for (const tracks of rows.flatMap((row) => [...row.querySelectorAll<HTMLElement>('.bg-tracks')])) {
      tracks.prepend(...ticks.map((tick) => h('span', { class: 'bg-grid', 'aria-hidden': 'true', style: `left:${tick.pct}%` })))
    }
    return h('section', { class: 'bg-board', id: 'bg-board', 'aria-label': 'Agents timeline' }, axis,
      h('div', { class: 'bg-lanes', role: 'list', onKeydown: (event: Event) => this.moveFocus(event as KeyboardEvent) }, ...rows), legend)
  }

  private lane(lane: BgLane, window: ReturnType<typeof axisWindow>, now: number): HTMLElement {
    const mark = agentMark(lane.kind)
    return h('div', { class: 'bg-lane', role: 'listitem', 'data-lane': lane.key },
      h('div', { class: 'bg-who' },
        h('div', { class: 'bg-who-row' }, mark, h('span', { class: 'bg-who-name', title: lane.title }, lane.title)),
        h('span', { class: 'bg-who-sub' }, `${lane.projectLabel} · ${count(lane.agents.length, 'agent')}`)),
      h('div', { class: 'bg-tracks' },
        h('div', { class: 'bg-now', style: `left:${window.nowPct}%`, 'aria-hidden': 'true' }),
        ...lane.agents.map((agent) => this.bar(agent, window, now))))
  }

  private bar(agent: BackgroundAgent, window: ReturnType<typeof axisWindow>, now: number): HTMLElement {
    const { left, width } = barGeometry(agent, window, now)
    const label = barLabel(agent, now)
    const end = agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt
    return h('div', { class: 'bg-track' },
      h('button', {
        class: `bg-bar st-${agent.status}${agent.automatic ? ' auto' : ''}${agent.key === this.selected ? ' selected' : ''}`, type: 'button', 'data-key': agent.key, 'data-status': agent.status,
        style: `left:${left}%;width:${width}%`, 'aria-label': label, 'aria-pressed': String(agent.key === this.selected), title: label,
        onClick: () => this.select(agent.key)
      }, h('span', { class: 'bg-dot', 'aria-hidden': 'true' }), h('span', { class: 'bg-bar-text', 'aria-hidden': 'true' }, `${agent.description} · ${spanLabel(end - agent.startedAt)}`)))
  }

  private select(key: string): void {
    this.selected = this.selected === key ? null : key
    this.render()
    this.body.querySelector<HTMLElement>(`.bg-bar[data-key="${CSS.escape(key)}"]`)?.focus()
  }

  private moveFocus(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const bars = [...this.body.querySelectorAll<HTMLElement>('.bg-bar')]
    const at = bars.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1 : Math.min(bars.length - 1, Math.max(0, at + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1)))
    event.preventDefault()
    bars[next]?.focus()
  }

  private row(label: string, value: string | null): HTMLElement | null {
    return value ? h('div', { class: 'bg-row' }, h('dt', {}, label), h('dd', {}, value)) : null
  }

  private details(agent: BackgroundAgent): HTMLElement {
    const now = agentsReport()?.generatedAt ?? Date.now()
    const end = agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt
    const model = modelLabel(agent.kind, agent.model ?? undefined)
    const priced = agent.costUsd === null ? '' : ` · ${costLabel(agent.costUsd)}`
    const open = findOpenSession(store.state, agent.kind, agent.parentId)
    const canGo = open !== null || agent.projectId !== null
    return h('aside', { class: 'bg-details', id: 'bg-details', 'aria-label': `Details for ${agent.description}` },
      h('div', { class: 'bg-details-head' },
        h('h2', {}, agent.description),
        h('button', { class: 'btn ghost small', type: 'button', id: 'bg-details-close', 'aria-label': 'Close details', onClick: () => this.select(agent.key) }, '×')),
      h('span', { class: `bg-status st-${agent.status}${agent.automatic ? ' auto' : ''}`, id: 'bg-detail-status' }, h('span', { class: 'bg-dot', 'aria-hidden': 'true' }), STATUS_LABELS[agent.status]),
      agent.statusNote ? h('p', { class: 'bg-note' }, agent.statusNote) : null,
      h('dl', { class: 'bg-facts' },
        this.row('Agent', AGENT_NAMES[agent.kind]),
        this.row('Type', agent.automatic ? `${agent.type} (automatic)` : agent.type),
        this.row('Model', model ?? null),
        this.row('Level', agent.depth > 1 ? `Sub-agent of an agent (level ${agent.depth})` : null),
        this.row('Parent session', agent.parentTitle),
        this.row('Project', agent.projectLabel),
        this.row('Started', stamp(agent.startedAt)),
        this.row(agent.status === 'running' ? 'Last activity' : 'Ended', stamp(agent.status === 'running' ? agent.lastActivityAt : end)),
        this.row('Duration', spanLabel(end - agent.startedAt)),
        this.row('Tokens', `${agent.tokensApprox ? '~' : ''}${compactTokens(agent.tokens)}${priced}`),
        this.row('Last step', agent.lastStep || null)),
      agent.result ? h('div', { class: 'bg-result' }, h('h3', {}, 'Result'), h('p', { id: 'bg-detail-result' }, agent.result)) : null,
      h('div', { class: 'bg-actions' },
        h('button', {
          class: 'btn', type: 'button', id: 'bg-go', disabled: !canGo, title: canGo ? 'Open the session that started this agent' : 'This session is in a folder that is not one of your projects',
          onClick: () => void this.goToSession(agent)
        }, 'Go to session'),
        h('button', { class: 'btn ghost', type: 'button', id: 'bg-show-file', onClick: () => void this.showFile(agent) }, 'Show file'),
        h('button', { class: 'btn ghost', type: 'button', id: 'bg-copy', disabled: !agent.result, onClick: () => void this.copyResult(agent) }, 'Copy result')))
  }

  private async goToSession(agent: BackgroundAgent): Promise<void> {
    const open = findOpenSession(store.state, agent.kind, agent.parentId)
    if (open) return focusOpenSession(open)
    if (!agent.projectId) return
    try {
      await resumeInNewPane({ agent: agent.kind, id: agent.parentId, title: agent.parentTitle, projectId: agent.projectId, modifiedAt: agent.lastActivityAt, startedAt: agent.startedAt, messageCount: 0 })
    } catch {
      toast('Could not open that session. Its project may no longer be available.')
    }
  }

  private async showFile(agent: BackgroundAgent): Promise<void> {
    try {
      if (!(await api.revealBackgroundAgent(agent.kind, agent.id))) toast('That transcript file is no longer available.')
    } catch {
      toast('Could not show the transcript file.')
    }
  }

  private async copyResult(agent: BackgroundAgent): Promise<void> {
    try {
      await api.writeClipboard(agent.result)
      toast('Result copied', 'info')
    } catch {
      toast('Could not copy the result.')
    }
  }
}
