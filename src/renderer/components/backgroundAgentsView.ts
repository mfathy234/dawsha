import { agentsMarkdown, fileTarget, retryPrompt, stateCountParts, stateSegments, summaryLine, todayTotals, type StateSegmentId } from '../../shared/agentList'
import type { BgFileTouch } from '../../shared/agentActivity'
import {
  BG_RANGES, DEFAULT_BG_FILTERS, STATUS_LABELS, applyFilters, barLabel, compactTokens, costLabel, filtersActive, groupBySession, projectOptions, spanLabel, statusCounts,
  type BackgroundAgent, type BgFilters, type BgKind, type BgRange, type BgSessionGroup
} from '../../shared/backgroundAgents'
import { allFolded, allOpen, isGroupOpen, setAllFolds, setFold, type FoldMap } from '../../shared/agentFolds'
import { agentsFailed, agentsFilters, agentsReport, onAgentsChange, refreshAgents, setAgentFilters } from '../backgroundAgents'
import { findOpenSession, focusOpenSession, resumeInNewPane, saveSettings } from '../actions'
import { api } from '../api'
import { h, icon } from '../dom'
import { openInFiles } from '../files/filesActions'
import { ICONS } from '../icons'
import { store, type AppState } from '../state'
import { paneTerminal } from '../terminalActions'
import { agentMark } from './agentMark'
import { agentDetails, emptyDetails, statusGlyph } from './backgroundAgentsDetail'
import { timelineView } from './backgroundAgentsTimeline'
import { openContextMenu } from './contextMenu'
import { selectMenu, syncSelectMenu } from './selectMenu'
import { toast } from './toast'
import './backgroundAgentsView.css'
import './backgroundAgentsFold.css'

const REFRESH_MS = 5000
const KIND_OPTIONS: { value: '' | BgKind; label: string }[] = [{ value: '', label: 'All agents' }, { value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function makeSelect(id: string, label: string, onChange: (value: string) => void): HTMLSelectElement {
  return h('select', { id, 'aria-label': label, onChange: (event: Event) => onChange((event.target as HTMLSelectElement).value) })
}

type Layout = 'list' | 'timeline'

export class BackgroundAgentsViewComponent {
  readonly el = h('main', { class: 'bg-view', 'aria-label': 'Background agents' })
  private visible = false
  private timer: number | undefined
  private selected: string | null = null
  private layout: Layout = 'list'
  private projects: readonly { id: string; name: string; folder: string }[] = []
  private projectSignature = ''
  private readonly states = h('div', { class: 'bg-seg', id: 'bg-states', role: 'group', 'aria-label': 'Filter by state' })
  private readonly totals = h('span', { class: 'bg-totals', id: 'bg-totals', role: 'status' })
  private readonly search = h('input', {
    class: 'text-input bg-search', id: 'bg-search', type: 'search', placeholder: 'Search agents, tasks, files…', 'aria-label': 'Search agents, tasks and files',
    onInput: (event: Event) => {
      if (!(event as InputEvent).isComposing) this.change({ query: (event.target as HTMLInputElement).value })
    }
  })
  private readonly projectSelect = makeSelect('bg-project-filter', 'Filter by project', (value) => this.change({ project: value || null }))
  private readonly rangeSelect = makeSelect('bg-range', 'Time range', (value) => this.change({ range: value as BgRange }))
  private readonly kindSelect = makeSelect('bg-kind', 'Filter by agent', (value) => this.change({ kinds: value ? [value as BgKind] : [] }))
  private readonly layoutSeg = h('div', { class: 'bg-seg', id: 'bg-layout', role: 'group', 'aria-label': 'Layout' })
  private readonly more = h('button', {
    class: 'icon-btn', type: 'button', id: 'bg-more', 'aria-label': 'More agent options', title: 'More agent options', 'aria-haspopup': 'menu', onClick: () => this.openMore()
  }, icon(ICONS.more))
  private readonly clear = h('button', { class: 'btn ghost small', type: 'button', id: 'bg-clear', onClick: () => this.clearFilters() }, 'Clear filters')
  private folds: FoldMap = {}
  private shownGroups: readonly BgSessionGroup[] = []
  private shownNow = 0
  private readonly body = h('div', { class: 'bg-body' })

  constructor() {
    this.rangeSelect.append(...BG_RANGES.map((range) => h('option', { value: range.value }, range.label)))
    this.kindSelect.append(...KIND_OPTIONS.map((option) => h('option', { value: option.value }, option.label)))
    this.el.append(
      h('div', { class: 'bg-head' }, h('h1', {}, 'Agents'), this.states, h('span', { class: 'spacer' }), this.totals),
      h('div', { class: 'bg-filters', role: 'group', 'aria-label': 'Search and filters' },
        this.search, selectMenu(this.projectSelect), selectMenu(this.rangeSelect), selectMenu(this.kindSelect), this.clear, h('span', { class: 'spacer' }), this.layoutSeg, this.more),
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
    this.folds = state.settings.agentFolds
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

  private setLayout(layout: Layout): void {
    if (layout === this.layout) return
    this.layout = layout
    this.render()
  }

  private syncControls(filters: BgFilters, agents: readonly BackgroundAgent[]): void {
    if (document.activeElement !== this.search && this.search.value !== filters.query) this.search.value = filters.query
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
    this.kindSelect.value = filters.kinds[0] ?? ''
    syncSelectMenu(this.projectSelect)
    syncSelectMenu(this.rangeSelect)
    syncSelectMenu(this.kindSelect)
    this.layoutSeg.replaceChildren(...(['list', 'timeline'] as const).map((layout) => h('button', {
      type: 'button', id: `bg-layout-${layout}`, 'aria-pressed': String(this.layout === layout), onClick: () => this.setLayout(layout)
    }, layout === 'list' ? 'List' : 'Timeline')))
  }

  private stateButton(segment: { state: StateSegmentId; label: string }, filters: BgFilters): HTMLElement {
    const pressed = segment.state === 'all' ? filters.statuses.length === 0 : filters.statuses.length === 1 && filters.statuses[0] === segment.state
    return h('button', {
      class: segment.state === 'all' ? '' : `st-${segment.state}`, type: 'button', id: `bg-status-${segment.state}`, 'aria-pressed': String(pressed),
      onClick: () => this.change({ statuses: segment.state === 'all' ? [] : [segment.state] })
    }, segment.label)
  }

  // A refresh that changes nothing leaves the page alone, so focus, hover and the open details stay put.
  private signature = ''

  private render(): void {
    const report = agentsReport()
    const filters = agentsFilters()
    const all = report?.agents ?? []
    const signature = JSON.stringify([
      all.map((agent) => [agent.key, agent.status, agent.lastActivityAt, agent.endedAt, agent.tokens, agent.description, agent.lastStep, agent.result, agent.statusNote, agent.tools[0]?.at, agent.tools.length, agent.files.length, agent.prompt.length]),
      filters, this.selected, this.layout, this.folds, agentsFailed(), report === null, this.projects.map((project) => project.id + project.name),
      Math.floor((report?.generatedAt ?? 0) / 60_000)
    ])
    if (signature === this.signature && this.el.isConnected) return
    this.signature = signature
    this.syncControls(filters, all)
    const shown = applyFilters(all, filters)
    const counts = statusCounts(applyFilters(all, filters, 'status'))
    this.states.replaceChildren(...stateSegments(counts).map((segment) => this.stateButton(segment, filters)))
    const today = todayTotals(all, report?.generatedAt ?? Date.now())
    this.totals.textContent = report ? `${today.approx ? '~' : ''}${compactTokens(today.tokens)} tokens${today.costUsd === null ? '' : ` · ${costLabel(today.costUsd)}`} today` : ''
    this.el.setAttribute('aria-busy', String(report === null && !agentsFailed()))
    const selected = shown.find((agent) => agent.key === this.selected) ?? null
    if (!selected) this.selected = null
    const now = report?.generatedAt ?? Date.now()
    this.shownNow = now
    this.shownGroups = shown.length > 0 ? groupBySession(shown, now) : []
    const content: HTMLElement[] = []
    if (agentsFailed() && !report) content.push(h('p', { class: 'field-error', role: 'alert' }, 'Could not read the agent transcripts. Try again in a moment.'))
    else if (!report) content.push(h('p', { class: 'bg-empty', role: 'status' }, 'Looking for background agents…'))
    else if (shown.length === 0) content.push(this.empty(all, filters))
    else content.push(this.layout === 'timeline' ? this.timeline(now) : this.board(now), this.detailsFor(selected))
    this.body.className = `bg-body${shown.length > 0 ? ' has-pane' : ''}${selected ? ' has-details' : ''}`
    const active = document.activeElement as HTMLElement | null
    const focusedKey = active?.closest<HTMLElement>('.bg-item, .bg-tl-bar')?.dataset.key
    const focusedGroup = active?.closest<HTMLElement>('.bg-group-toggle')?.dataset.session
    this.body.replaceChildren(...content)
    if (focusedKey) this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus()
    else if (focusedGroup) this.body.querySelector<HTMLElement>(`.bg-group-toggle[data-session="${CSS.escape(focusedGroup)}"]`)?.focus()
  }

  private setFolds(folds: FoldMap): void {
    this.folds = folds
    store.set((state) => ({ ...state, settings: { ...state.settings, agentFolds: folds } }))
    void saveSettings({ agentFolds: folds })
    this.render()
  }

  private foldAll(open: boolean): void {
    this.setFolds(setAllFolds(this.folds, this.shownGroups, open))
  }

  private toggleGroup(group: BgSessionGroup, open = !isGroupOpen(group, this.folds)): void {
    if (open === isGroupOpen(group, this.folds)) return
    this.setFolds(setFold(this.folds, group.sessionKey, open))
  }

  private openMore(): void {
    const box = this.more.getBoundingClientRect()
    const grouped = this.layout === 'list' && this.shownGroups.length > 0
    const automatic = agentsFilters().showAutomatic
    openContextMenu({
      x: box.right - 220, y: box.bottom + 4, label: 'More agent options', returnFocus: this.more,
      entries: [
        { label: 'Expand all', disabled: !grouped || allOpen(this.shownGroups, this.folds), run: () => this.foldAll(true) },
        { label: 'Collapse all', disabled: !grouped || allFolded(this.shownGroups, this.folds), run: () => this.foldAll(false) },
        'separator',
        { label: 'Show automatic reviews', keys: automatic ? 'On' : 'Off', run: () => this.change({ showAutomatic: !automatic }) },
        { label: 'Export visible as Markdown', disabled: this.shownGroups.length === 0, run: () => void this.exportMarkdown() }
      ]
    })
  }

  private async exportMarkdown(): Promise<void> {
    try {
      await api.writeClipboard(agentsMarkdown(this.shownGroups, this.shownNow))
      toast('Markdown copied', 'info')
    } catch {
      toast('Could not copy the agents.')
    }
  }

  private empty(all: readonly BackgroundAgent[], filters: BgFilters): HTMLElement {
    const visibleBase = applyFilters(all, { ...DEFAULT_BG_FILTERS, range: filters.range, showAutomatic: filters.showAutomatic })
    const phrase = BG_RANGES.find((range) => range.value === filters.range)?.phrase ?? 'this range'
    if (visibleBase.length === 0) {
      const hidden = all.filter((agent) => agent.automatic).length
      return h('div', { class: 'bg-empty', id: 'bg-empty', role: 'status' },
        h('p', { class: 'bg-empty-title' }, `No background agents in ${phrase}`),
        h('p', { class: 'muted' }, 'They appear here when a Claude Code or Codex session starts agents.'),
        hidden > 0 ? h('p', { class: 'muted' }, `${count(hidden, 'automatic review')} hidden. Turn on Show automatic reviews in the ⋯ menu to see them.`) : null)
    }
    return h('div', { class: 'bg-empty', id: 'bg-nomatch', role: 'status' },
      h('p', { class: 'bg-empty-title' }, 'No agents match these filters'),
      h('p', { class: 'muted' }, `Nothing in ${phrase} fits. Clear the filters to see every agent.`),
      h('button', { class: 'btn', type: 'button', id: 'bg-empty-clear', onClick: () => this.clearFilters() }, 'Clear filters'))
  }

  private timeline(now: number): HTMLElement {
    return h('div', { class: 'bg-main', onKeydown: (event: Event) => this.moveBars(event as KeyboardEvent) },
      timelineView(this.shownGroups, now, this.selected, (key) => this.select(key)))
  }

  private board(now: number): HTMLElement {
    const groups = this.shownGroups.map((group) => this.group(group, now))
    return h('div', { class: 'bg-main' }, h('section', { class: 'bg-board', id: 'bg-board', 'aria-label': 'Agents by session' },
      h('div', { class: 'bg-groups', onKeydown: (event: Event) => this.moveFocus(event as KeyboardEvent) }, ...groups),
      h('p', { class: 'bg-hint' }, 'Up and Down move between rows; Left and Right fold or unfold a session.')))
  }

  private group(group: BgSessionGroup, now: number): HTMLElement {
    const open = isGroupOpen(group, this.folds)
    const listId = `bg-items-${group.sessionKey.replace(/[^A-Za-z0-9_-]/g, '_')}`
    const parts = stateCountParts(group)
    return h('section', { class: `bg-group${open ? ' open' : ''}`, 'data-session': group.sessionKey },
      h('h2', { class: 'bg-group-head' },
        h('button', {
          class: 'bg-group-toggle', type: 'button', id: `${listId}-toggle`, 'data-session': group.sessionKey, 'aria-expanded': String(open), 'aria-controls': listId,
          title: group.title, onClick: () => this.toggleGroup(group)
        },
        h('span', { class: 'bg-chevron', 'aria-hidden': 'true' }, icon(ICONS.chevronRight)),
        agentMark(group.agentKind),
        h('span', { class: 'bg-group-who' },
          h('span', { class: 'bg-group-title' }, group.title),
          h('span', { class: 'bg-group-meta' }, h('span', { class: 'bg-group-project' }, group.project), h('span', { 'aria-hidden': 'true' }, ' · '), h('span', { class: 'bg-group-total' }, count(group.agents.length, 'agent')))),
        h('span', { class: 'bg-group-counts' }, ...parts.flatMap((part, index) => [
          ...(index > 0 ? [document.createTextNode(' · ')] : []),
          h('span', { class: `bg-count st-${part.state}` }, part.text)
        ])))),
      h('div', { class: 'bg-items', id: listId, role: 'group', 'aria-labelledby': `${listId}-toggle`, hidden: !open }, ...(open ? group.agents.map((agent) => this.item(agent, now)) : [])))
  }

  private item(agent: BackgroundAgent, now: number): HTMLElement {
    const label = barLabel(agent, now)
    const end = agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt
    return h('button', {
      class: `bg-item st-${agent.status}${agent.automatic ? ' auto' : ''}${agent.key === this.selected ? ' selected' : ''}`, type: 'button', 'data-key': agent.key, 'data-status': agent.status,
      'aria-label': label, 'aria-pressed': String(agent.key === this.selected), onClick: () => this.select(agent.key)
    },
      h('span', { class: 'bg-item-icon', 'aria-hidden': 'true' }, statusGlyph(agent.status)),
      h('span', { class: 'bg-item-name', 'aria-hidden': 'true', title: agent.description }, agent.description),
      h('span', { class: 'bg-item-status', 'aria-hidden': 'true' }, STATUS_LABELS[agent.status]),
      h('span', { class: 'bg-item-time', 'aria-hidden': 'true' }, spanLabel(end - agent.startedAt)),
      h('span', { class: 'bg-item-note', 'aria-hidden': 'true' }, summaryLine(agent)))
  }

  private select(key: string | null): void {
    this.selected = key
    this.render()
    if (key) this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus()
  }

  private moveBars(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const bars = [...this.body.querySelectorAll<HTMLElement>('.bg-tl-bar')]
    const at = bars.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1 : Math.min(bars.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))
    bars[next]?.focus()
  }

  private moveFocus(event: KeyboardEvent): void {
    const stops = [...this.body.querySelectorAll<HTMLElement>('.bg-group-toggle, .bg-item')]
    const at = stops.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    const current = stops[at]
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const key = current.closest<HTMLElement>('.bg-group')?.dataset.session
      const group = this.shownGroups.find((candidate) => candidate.sessionKey === key)
      if (!group) return
      event.preventDefault()
      if (current.classList.contains('bg-group-toggle')) this.toggleGroup(group, event.key === 'ArrowRight')
      else if (event.key === 'ArrowLeft') this.body.querySelector<HTMLElement>(`.bg-group-toggle[data-session="${CSS.escape(group.sessionKey)}"]`)?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? stops.length - 1 : Math.min(stops.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))
    event.preventDefault()
    stops[next]?.focus()
  }

  private detailsFor(agent: BackgroundAgent | null): HTMLElement {
    if (!agent) return emptyDetails()
    const now = agentsReport()?.generatedAt ?? Date.now()
    const open = findOpenSession(store.state, agent.kind, agent.parentId)
    const details = agentDetails(agent, {
      now,
      canGo: open !== null || agent.projectId !== null,
      canRetry: open !== null,
      displayPath: (file) => fileTarget(agent, file.path, this.projects)?.path ?? file.path,
      canOpenFile: (file) => fileTarget(agent, file.path, this.projects) !== null,
      onClose: () => this.select(null),
      onGo: () => void this.goToSession(agent),
      onShowFile: () => void this.showFile(agent),
      onCopy: () => void this.copyResult(agent),
      onRetry: () => this.askRetry(agent),
      onOpenFile: (file) => this.openFile(agent, file)
    })
    details.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !window.matchMedia('(max-width: 899px)').matches) return
      event.stopPropagation()
      const key = agent.key
      this.select(null)
      this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus()
    })
    return details
  }

  private openFile(agent: BackgroundAgent, file: BgFileTouch): void {
    const target = fileTarget(agent, file.path, this.projects)
    if (target) openInFiles({ projectId: target.projectId, folder: target.folder }, target.path, { pin: true })
  }

  private askRetry(agent: BackgroundAgent): void {
    const open = findOpenSession(store.state, agent.kind, agent.parentId)
    if (!open) {
      toast('Open the session first, then ask it to retry.', 'info')
      return
    }
    focusOpenSession(open)
    const view = paneTerminal(open.paneId)
    view?.focus()
    view?.insertText(retryPrompt(agent))
    toast('Retry request typed into the session. Press Enter there to send it.', 'info')
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
