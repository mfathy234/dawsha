import { findOpenSession, focusOpenSession, openChanges, resumeInNewPane } from '../actions'
import { api } from '../api'
import { bind, formatShortcut } from '../../shared/shortcuts'
import { h, icon } from '../dom'
import type { PaneView } from '../derive'
import { sessionState, type SessionState } from '../../shared/sessionState'
import {
  TIMELINE_FILTERS,
  basename,
  computeInsights,
  filterEvents,
  formatClock,
  formatSpan,
  highlightParts,
  mergeTimeline,
  relativePath,
  renderTimelineMarkdown,
  searchEvents,
  stateSegments,
  stateWord,
  stepMatch,
  timelineFileName,
  timelineSpan,
  type TimelineEvent,
  type TimelineFilter,
  type TimelineInsights,
  type TimelineRequest
} from '../../shared/timeline'
import { formatTokens, formatUsd } from '../../shared/usage'
import { folderOfPane, paneById, store } from '../state'
import { closeTimeline, openTimelineWith, takeTimelineIntent, timelineRequest, type TimelineIntent } from '../timelineActions'
import { localEvents, localVersion } from '../timelineLog'
import { replayPane } from '../replayActions'
import { ICONS } from '../icons'
import type { SearchHit } from '../../shared/timelineSearch'
import type { ResumeSession } from '../../shared/types'
import { AllSessionsSearch } from './timelineAllSearch'
import { stateIcon } from './stateIcon'
import { toast } from './toast'

const REFRESH_MS = 4000
const NOW_BUCKET_MS = 30_000
const ROW_LIMIT = 500

const KIND_SVG: Record<string, string> = {
  prompt: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  reply: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 2.5h8v6H6l-2.5 2v-2H2z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>',
  read: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 1.5h4l2 2v7H3z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  edit: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 10l1-3 5-5 2 2-5 5z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  command: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 3l3 3-3 3M6.5 9.5H10" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pass: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 6.2l2 2 4-4.4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  error: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M6 1.5 11 10.5H1z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/><path d="M6 5v2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  allow: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M6 .8 11.2 6 6 11.2.8 6z" fill="currentColor"/></svg>'
}

function highlighted(text: string, query: string): (Node | string)[] {
  return highlightParts(text, query).map((part) => (part.match ? h('mark', { class: 'tl-hit' }, part.text) : part.text))
}

function relativeEvent(event: TimelineEvent, folder: string): TimelineEvent {
  if (event.kind === 'edit' && event.path) {
    const path = relativePath(event.path, folder)
    return { ...event, path, text: path }
  }
  if (event.kind === 'read' && event.paths) return { ...event, paths: event.paths.map((path) => relativePath(path, folder)) }
  return event
}

export class TimelinePanel {
  readonly el: HTMLElement
  private readonly summary = h('span', { class: 'tl-summary' })
  private readonly bar = h('div', { class: 'tl-bar', role: 'img', hidden: true })
  private readonly legend = h('div', { class: 'tl-legend', hidden: true })
  private readonly filters = h('div', { class: 'tl-filters', role: 'group', 'aria-label': 'Show' })
  private readonly search = h('input', {
    class: 'tl-search timeline-search',
    type: 'search',
    placeholder: 'Search prompts, files and commands',
    'aria-label': 'Search the timeline',
    autocomplete: 'off',
    spellcheck: 'false'
  }) as HTMLInputElement
  private readonly count = h('span', { class: 'tl-count', 'aria-live': 'polite' })
  private readonly prev = h('button', { class: 'icon-btn tl-step', type: 'button', 'aria-label': 'Previous match', title: 'Previous match (Shift+Enter)' }, '↑')
  private readonly next = h('button', { class: 'icon-btn tl-step', type: 'button', 'aria-label': 'Next match', title: 'Next match (Enter)' }, '↓')
  private readonly insightsToggle = h('button', { class: 'tl-insights-toggle', type: 'button', 'aria-expanded': 'true' }, 'Insights')
  private readonly insightsBody = h('div', { class: 'tl-insights-body' })
  private readonly insights = h('section', { class: 'tl-insights', 'aria-label': 'Insights', hidden: true }, this.insightsToggle, this.insightsBody)
  private readonly list = h('div', { class: 'tl-list', 'aria-label': 'Session events' })
  private readonly empty = h('p', { class: 'tl-empty', role: 'status' })
  private readonly exportButton = h('button', { class: 'btn small tl-export', type: 'button' }, 'Export as Markdown')
  private log: TimelineEvent[] = []
  private revision = 0
  private version: string | undefined
  private truncated = false
  private limit = ROW_LIMIT
  private merged: { key: string; events: TimelineEvent[] } | null = null
  private readonly note = h('p', { class: 'tl-note', hidden: true }, 'Earlier events are not shown: the session log is large.')
  private loaded: 'loading' | 'ready' | 'none' = 'loading'
  private view: PaneView | null = null
  private opened = false
  private timer: ReturnType<typeof setInterval> | null = null
  private token = 0
  private filter: TimelineFilter = 'all'
  private query = ''
  private matchAt = -1
  private revealMatch = false
  private insightsOpen = true
  private signature = ''
  private lastState: SessionState | null = null
  private scope: 'session' | 'all' = 'session'
  private past: { session: ResumeSession; request: TimelineRequest | null; folder: string } | null = null
  private pending: NonNullable<TimelineIntent['target']> | null = null
  private spotlight: number | null = null
  private readonly scopeButtons = [
    h('button', { class: 'tl-scope', type: 'button', 'data-scope': 'session', 'aria-pressed': 'true' }, 'This session'),
    h('button', { class: 'tl-scope', type: 'button', 'data-scope': 'all', 'aria-pressed': 'false' }, 'All sessions')
  ]
  private readonly pastTitle = h('span', { class: 'tl-past-title' })
  private readonly pastBar = h('div', { class: 'tl-past', hidden: true })
  private readonly all: AllSessionsSearch

  constructor(private readonly paneId: string) {
    this.all = new AllSessionsSearch({
      paneId: this.paneId,
      query: () => this.query,
      filter: () => this.filter,
      project: () => {
        const project = this.view?.project
        return project ? { id: project.id, name: project.name } : null
      },
      projectName: (id) => store.state.settings.projects.find((entry) => entry.id === id)?.name ?? '',
      open: (session, hit) => this.openResult(session, hit)
    })
    const filterButtons = TIMELINE_FILTERS.map((entry) =>
      h('button', { class: 'tl-filter', type: 'button', 'data-filter': entry.id, 'aria-pressed': String(entry.id === this.filter), onClick: () => this.setFilter(entry.id) }, entry.label)
    )
    this.filters.append(...filterButtons)
    const close = h('button', { class: 'icon-btn tl-close', type: 'button', 'aria-label': 'Close timeline', title: 'Close timeline', onClick: () => closeTimeline() }, '×')
    const replay = h(
      'button',
      { class: 'btn small primary tl-replay', type: 'button', title: 'Replay this session’s terminal', onClick: () => void replayPane(this.paneId) },
      h('span', { class: 'tl-replay-icon', 'aria-hidden': 'true' }, icon(ICONS.replay)),
      'Replay'
    )
    const head = h('div', { class: 'tl-head' }, h('h2', {}, 'Timeline'), this.summary, h('span', { class: 'spacer' }), replay, close)
    const searchRow = h('div', { class: 'tl-search-row' }, this.search, this.count, this.prev, this.next)
    const scopeRow = h('div', { class: 'tl-scope-row', role: 'group', 'aria-label': 'Search scope' }, ...this.scopeButtons)
    const resume = h('button', { class: 'btn small primary tl-resume', type: 'button', onClick: () => this.resumePast() }, 'Resume session')
    const back = h('button', { class: 'btn small tl-back', type: 'button', onClick: () => this.leavePast() }, 'Back to results')
    this.pastBar.append(this.pastTitle, h('span', { class: 'spacer' }), back, resume)
    const top = h('div', { class: 'tl-top' }, head, this.pastBar, h('div', { class: 'tl-bar-wrap' }, this.bar, this.legend), this.filters, scopeRow, searchRow)
    const foot = h('div', { class: 'tl-foot' }, this.exportButton, h('span', { class: 'spacer' }), h('span', { class: 'tl-hint' }, formatShortcut(bind('Ctrl+Shift+T'))))
    this.el = h('aside', { class: 'timeline-panel', 'aria-label': 'Timeline', hidden: true }, top, this.insights, h('div', { class: 'tl-scroll' }, this.all.el, this.note, this.list, this.empty), foot)
    for (const button of this.scopeButtons) button.addEventListener('click', () => this.setScope(button.dataset.scope === 'all' ? 'all' : 'session'))
    this.search.addEventListener('input', () => {
      this.query = this.search.value
      this.spotlight = null
      if (this.searchingAll()) {
        this.all.schedule()
        this.render(true)
        return
      }
      this.matchAt = this.visibleHits().length > 0 ? 0 : -1
      this.revealMatch = true
      this.render()
    })
    this.search.addEventListener('keydown', (event) => this.onSearchKey(event))
    this.prev.addEventListener('click', () => this.step(-1))
    this.next.addEventListener('click', () => this.step(1))
    this.insightsToggle.addEventListener('click', () => {
      this.insightsOpen = !this.insightsOpen
      this.render(true)
    })
    this.exportButton.addEventListener('click', () => void this.exportMarkdown())
  }

  update(view: PaneView, open: boolean): void {
    this.view = view
    this.el.hidden = !open
    if (!open) {
      this.stop()
      return
    }
    const intent = takeTimelineIntent(this.paneId)
    if (intent) this.applyIntent(intent)
    const state = sessionState({ status: view.status, attention: view.attention })
    if (!this.opened) {
      this.opened = true
      this.lastState = state
      this.timer = setInterval(() => this.tick(), REFRESH_MS)
      void this.fetch()
      queueMicrotask(() => this.search.focus())
    } else if (state !== this.lastState) {
      this.lastState = state
      void this.fetch()
    }
    this.render()
  }

  private searchingAll(): boolean {
    return this.scope === 'all' && this.past === null
  }

  private resetLog(): void {
    this.log = []
    this.version = undefined
    this.truncated = false
    this.loaded = 'loading'
    this.revision += 1
    this.limit = ROW_LIMIT
  }

  private setScope(scope: 'session' | 'all'): void {
    if (scope === this.scope && this.past === null) return
    const wasPast = this.past !== null
    this.scope = scope
    this.past = null
    this.spotlight = null
    this.pending = null
    if (wasPast) {
      this.resetLog()
      void this.fetch()
    }
    if (scope === 'all') {
      if (this.filter === 'approvals') this.filter = 'all'
      this.all.syncProjects()
      if (this.query.trim() !== '') this.all.schedule(0)
    } else {
      this.all.cancel()
    }
    this.search.focus()
    this.render(true)
  }

  private applyIntent(intent: TimelineIntent): void {
    const wasPast = this.past !== null
    this.past = null
    this.scope = intent.scope ?? 'session'
    if (intent.query !== undefined) {
      this.query = intent.query
      this.search.value = intent.query
    }
    if (intent.target) {
      this.filter = 'all'
      this.pending = intent.target
    }
    if (this.scope === 'all') {
      this.all.syncProjects()
      queueMicrotask(() => this.search.focus())
    }
    if (intent.scope === 'all' && this.query.trim() !== '') this.all.schedule(0)
    if (wasPast) {
      this.resetLog()
      if (this.opened) void this.fetch()
    }
    this.render(true)
  }

  private openResult(session: ResumeSession, hit: SearchHit | undefined): void {
    const target = hit ? { at: hit.at, kind: hit.kind, text: hit.text } : undefined
    const open = findOpenSession(store.state, session.agent, session.id)
    if (open) {
      focusOpenSession(open)
      openTimelineWith(open.paneId, { query: this.query, target })
      return
    }
    const folder = store.state.settings.projects.find((entry) => entry.id === session.projectId)?.folder ?? ''
    this.past = { session, folder, request: folder ? { agent: session.agent, sessionId: session.id, folder } : null }
    this.pending = target ?? null
    this.filter = 'all'
    this.spotlight = null
    this.resetLog()
    void this.fetch()
    this.render(true)
  }

  private leavePast(): void {
    this.past = null
    this.pending = null
    this.spotlight = null
    this.resetLog()
    this.render(true)
  }

  private resumePast(): void {
    if (this.past) void resumeInNewPane(this.past.session)
  }

  dispose(): void {
    this.stop()
    this.all.cancel()
    this.el.remove()
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.opened = false
    this.token += 1
  }

  private tick(): void {
    if (!this.el.isConnected) return this.stop()
    if (this.scope === 'all') return
    void this.fetch()
  }

  private async fetch(): Promise<void> {
    const request = this.past ? this.past.request : timelineRequest(this.paneId)
    const token = ++this.token
    if (!request) {
      this.loaded = 'none'
      this.log = []
      this.version = undefined
      this.revision += 1
      this.render()
      return
    }
    const result = await api.sessionTimeline({ ...request, version: this.version }).catch(() => null)
    if (token !== this.token || !this.opened) return
    if (result?.status === 'ok') {
      this.log = result.events
      this.version = result.version
      this.truncated = result.truncated
      this.revision += 1
      this.loaded = 'ready'
    } else if (result?.status !== 'unchanged' && this.loaded === 'loading') {
      this.loaded = 'none'
    }
    this.render()
  }

  private folder(): string {
    if (this.past) return this.past.folder
    const pane = paneById(store.state, this.paneId)
    return (pane ? folderOfPane(store.state, pane) : null) ?? ''
  }

  private events(): TimelineEvent[] {
    const folder = this.folder()
    const key = `${this.revision}|${this.past ? 'past' : localVersion(this.paneId)}|${folder}`
    if (this.merged?.key === key) return this.merged.events
    const events = mergeTimeline(this.log, this.past ? [] : localEvents(this.paneId)).map((event) => relativeEvent(event, folder))
    this.merged = { key, events }
    return events
  }

  private visible(): TimelineEvent[] {
    return filterEvents(this.events(), this.filter)
  }

  private visibleHits(): number[] {
    return searchEvents(this.visible(), this.query)
  }

  private setFilter(filter: TimelineFilter): void {
    this.filter = filter
    this.spotlight = null
    if (this.searchingAll()) this.all.schedule(0)
    this.matchAt = this.visibleHits().length > 0 ? 0 : -1
    this.revealMatch = true
    this.render(true)
  }

  private step(direction: 1 | -1): void {
    const hits = this.visibleHits()
    this.spotlight = null
    this.matchAt = stepMatch(hits.length, this.matchAt, direction)
    this.revealMatch = true
    this.render(true)
  }

  private onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (this.searchingAll()) this.all.schedule(0)
      else this.step(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (this.query !== '') {
        this.search.value = ''
        this.query = ''
        this.matchAt = -1
        this.spotlight = null
        if (this.searchingAll()) this.all.schedule(0)
        this.render(true)
      } else {
        closeTimeline()
      }
    }
  }

  private render(force = false): void {
    const view = this.view
    if (!view) return
    const now = Math.max(view.now, Date.now())
    const cost = view.info.costUsd
    const tokens = view.info.tokens
    const signature = JSON.stringify([
      this.revision,
      this.scope,
      this.past?.session.id ?? '',
      this.pending ? 1 : 0,
      this.spotlight,
      localVersion(this.paneId),
      this.limit,
      this.filter,
      this.query,
      this.matchAt,
      this.insightsOpen,
      this.loaded,
      Math.floor(now / NOW_BUCKET_MS),
      view.status,
      cost,
      tokens
    ])
    if (!force && signature === this.signature) return
    this.signature = signature
    this.renderScope()
    if (this.searchingAll()) return this.renderAll()
    this.all.el.hidden = true
    this.list.hidden = false
    const events = this.events()
    const shown = filterEvents(events, this.filter)
    if (this.pending && this.loaded === 'ready') this.reveal(shown)
    const hits = searchEvents(shown, this.query)
    if (this.matchAt >= hits.length) this.matchAt = hits.length > 0 ? 0 : -1
    const live = view.status !== 'exited' && this.past === null
    const insights = computeInsights(events, now)
    this.renderHead(events, now, live, cost)
    this.renderBar(events, now)
    this.renderFilters()
    this.renderCount(hits.length)
    this.renderInsights(insights, cost, tokens)
    this.renderList(shown, hits)
  }

  private renderScope(): void {
    for (const button of this.scopeButtons) button.setAttribute('aria-pressed', String((button.dataset.scope === 'all') === (this.scope === 'all')))
    const searching = this.searchingAll()
    this.search.placeholder = searching ? 'Search every session' : 'Search prompts, files and commands'
    this.search.setAttribute('aria-label', searching ? 'Search all sessions' : 'Search the timeline')
    this.pastBar.hidden = this.past === null
    this.pastTitle.textContent = this.past ? `Past session: ${this.past.session.title}` : ''
    const approvals = this.filters.querySelector<HTMLElement>('[data-filter="approvals"]')
    if (approvals) approvals.hidden = this.scope === 'all'
    this.filters.hidden = false
  }

  private renderAll(): void {
    this.all.el.hidden = false
    for (const element of [this.bar, this.legend, this.insights, this.list, this.note, this.empty]) element.hidden = true
    this.renderFilters()
    this.summary.textContent = ''
    const total = this.all.count()
    this.count.textContent = this.query.trim() !== '' && total > 0 ? `${total} session${total === 1 ? '' : 's'}` : ''
    this.prev.disabled = true
    this.next.disabled = true
  }

  /** Finds the event a search result pointed at, selects it and scrolls to it. */
  private reveal(shown: TimelineEvent[]): void {
    const target = this.pending
    if (!target) return
    this.pending = null
    let index = shown.findIndex((event) => event.at === target.at && event.kind === target.kind && event.text === target.text)
    if (index < 0) index = shown.findIndex((event) => event.at === target.at && event.kind === target.kind)
    if (index < 0) return
    this.spotlight = index
    this.revealMatch = true
    const hits = searchEvents(shown, this.query)
    this.matchAt = hits.indexOf(index)
  }

  private renderHead(events: TimelineEvent[], now: number, live: boolean, cost: number | null): void {
    const span = timelineSpan(events, now, live)
    const prompts = events.filter((event) => event.kind === 'prompt').length
    const parts = [span ? formatSpan(span.endedAt - span.startedAt) : null, `${prompts} prompt${prompts === 1 ? '' : 's'}`, cost !== null ? formatUsd(cost) : null]
    this.summary.textContent = parts.filter((part): part is string => part !== null).join(' · ')
  }

  private renderBar(events: TimelineEvent[], now: number): void {
    const segments = stateSegments(events, now)
    this.bar.hidden = segments.length === 0
    this.legend.hidden = segments.length === 0
    if (segments.length === 0) {
      this.bar.replaceChildren()
      this.legend.replaceChildren()
      return
    }
    const totals = new Map<SessionState, number>()
    const segs = segments.map((segment) => {
      const length = segment.end - segment.start
      totals.set(segment.state, (totals.get(segment.state) ?? 0) + length)
      return h('div', { class: `tl-seg tl-seg-${segment.state}`, style: `flex:${Math.max(length, 1)}` })
    })
    const order: SessionState[] = ['working', 'needs', 'done', 'idle']
    const present = order.filter((state) => (totals.get(state) ?? 0) > 0)
    const words = present.map((state) => `${stateWord(state)} ${formatSpan(totals.get(state) ?? 0)}`)
    this.bar.setAttribute('aria-label', words.join(', '))
    this.bar.replaceChildren(...segs)
    this.legend.replaceChildren(
      ...present.map((state) => h('span', { class: 'tl-legend-item' }, h('i', { class: `tl-swatch tl-seg-${state}`, 'aria-hidden': 'true' }), `${stateWord(state)} ${formatSpan(totals.get(state) ?? 0)}`))
    )
  }

  private renderFilters(): void {
    for (const button of this.filters.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === this.filter))
    }
  }

  private renderCount(total: number): void {
    const searching = this.query.trim() !== ''
    this.count.textContent = searching ? (total === 0 ? 'No matches' : `${this.matchAt + 1} of ${total}`) : ''
    this.prev.disabled = total === 0
    this.next.disabled = total === 0
  }

  private renderInsights(insights: TimelineInsights, cost: number | null, tokens: number | null): void {
    const rows = this.insightRows(insights, cost, tokens)
    this.insights.hidden = rows.length === 0
    this.insightsToggle.setAttribute('aria-expanded', String(this.insightsOpen))
    this.insightsBody.hidden = !this.insightsOpen
    this.insightsBody.replaceChildren(...rows)
  }

  private insightRows(insights: TimelineInsights, cost: number | null, tokens: number | null): HTMLElement[] {
    const row = (label: string, ...value: (Node | string)[]): HTMLElement =>
      h('div', { class: 'tl-insight' }, h('span', { class: 'tl-insight-label' }, label), h('span', { class: 'tl-insight-value' }, ...value))
    const rows: HTMLElement[] = []
    if (insights.time) {
      const { working, needs, done } = insights.time
      rows.push(row('Time', `working ${formatSpan(working)} · waiting on you ${formatSpan(needs)} · done ${formatSpan(done)}`))
    }
    if (insights.waits) {
      rows.push(row('You kept it waiting', `${formatSpan(insights.waits.total)} in total, longest ${formatSpan(insights.waits.longest)}`))
    }
    if (insights.files.length > 0) {
      const files = insights.files.map((file) =>
        h('li', {}, h('span', { class: 'tl-file', title: file.path }, file.path), h('span', { class: 'tl-file-count' }, `${file.edits} edit${file.edits === 1 ? '' : 's'}`))
      )
      rows.push(h('div', { class: 'tl-insight tl-insight-files' }, h('span', { class: 'tl-insight-label' }, 'Files touched most'), h('ul', { class: 'tl-files' }, ...files)))
    }
    if (insights.commands > 0) rows.push(row('Commands run', String(insights.commands)))
    if (insights.tests.length > 0) {
      const runs = insights.tests.map((run) => {
        const mark = h('span', { class: `tl-run ${run.ok ? 'pass' : 'fail'}`, title: run.ok ? 'Passed' : 'Failed' }, icon(run.ok ? KIND_SVG.pass : KIND_SVG.fail))
        mark.append(h('span', { class: 'sr-only' }, run.ok ? 'passed' : 'failed'))
        return mark
      })
      rows.push(row(`Test runs (${insights.tests.length})`, h('span', { class: 'tl-runs' }, ...runs)))
    }
    if (insights.permissions) {
      const { prompts, allowed, denied } = insights.permissions
      const terminal = Math.max(0, prompts - allowed - denied)
      const parts = [`${prompts} prompt${prompts === 1 ? '' : 's'}`, `${allowed} allowed here`, `${denied} denied here`]
      if (terminal > 0) parts.push(`${terminal} answered in the terminal`)
      rows.push(row('Permissions', parts.join(' · ')))
    }
    const spend = [cost !== null ? formatUsd(cost) : null, tokens !== null && tokens > 0 ? `${formatTokens(tokens)} tokens` : null].filter(Boolean)
    if (spend.length > 0) rows.push(row('Cost', spend.join(' · ')))
    return rows
  }

  private renderList(shown: TimelineEvent[], hits: number[]): void {
    const scroll = this.list.parentElement
    const top = scroll?.scrollTop ?? 0
    const active = this.spotlight ?? hits[this.matchAt]
    if (active !== undefined && shown.length - active > this.limit) this.limit = shown.length - active
    const start = Math.max(0, shown.length - this.limit)
    const hitSet = new Set(hits)
    const rows = shown.slice(start).map((event, index) => this.row(event, hitSet.has(start + index), start + index === active))
    const earlier =
      start > 0
        ? [
            h(
              'button',
              {
                class: 'btn small tl-earlier',
                type: 'button',
                onClick: () => {
                  this.limit += ROW_LIMIT
                  this.render(true)
                }
              },
              `Show earlier events (${start})`
            )
          ]
        : []
    this.list.replaceChildren(...earlier, ...rows)
    this.note.hidden = !this.truncated
    const message = this.emptyMessage(shown.length)
    this.empty.hidden = message === ''
    this.empty.textContent = message
    if (scroll) scroll.scrollTop = top
    if (this.revealMatch) {
      this.revealMatch = false
      rows[active === undefined ? -1 : active - start]?.scrollIntoView({ block: 'nearest' })
    }
  }

  private emptyMessage(count: number): string {
    if (count > 0) return ''
    if (this.loaded === 'loading') return 'Loading the session log…'
    if (this.loaded === 'none' && this.events().length === 0) return 'No session log found for this pane yet.'
    return this.query.trim() !== '' || this.filter !== 'all' ? 'No events match.' : 'No events yet.'
  }

  private row(event: TimelineEvent, matched: boolean, current: boolean): HTMLElement {
    const { dot, body, tone } = this.rowParts(event)
    const classes = ['tl-event', `tl-${event.kind}`, tone, matched ? 'matched' : '', current ? 'current' : ''].filter(Boolean).join(' ')
    const time = h('span', { class: 'tl-time' }, formatClock(event.at))
    const content = [time, h('span', { class: 'tl-dot', 'aria-hidden': 'true' }, dot), h('div', { class: 'tl-body' }, ...body)]
    if (event.kind === 'edit' && event.path) {
      const path = event.path
      return h('button', { class: classes, type: 'button', 'aria-label': `${formatClock(event.at)} Edited ${path}. Show in Changes`, title: `Show ${path} in Changes`, onClick: () => void openChanges(this.paneId, path) }, ...content)
    }
    return h('div', { class: classes, 'aria-current': current ? 'true' : undefined }, ...content)
  }

  private rowParts(event: TimelineEvent): { dot: Node; body: (Node | string | null)[]; tone: string } {
    const q = this.query
    const mono = (text: string, title?: string): HTMLElement => h('span', { class: 'tl-mono', title }, ...highlighted(text, q))
    switch (event.kind) {
      case 'prompt':
        return { dot: icon(KIND_SVG.prompt), tone: 'tl-accent', body: [h('b', {}, 'You'), ' ', h('span', { class: 'muted' }, 'asked'), h('div', { class: 'tl-quote' }, ...highlighted(event.text, q))] }
      case 'reply':
        return { dot: icon(KIND_SVG.reply), tone: '', body: [h('span', { class: 'muted' }, ...highlighted(event.text, q))] }
      case 'read':
        return { dot: icon(KIND_SVG.read), tone: '', body: [h('span', { class: 'muted', title: (event.paths ?? []).join('\n') }, ...highlighted(event.text, q))] }
      case 'edit':
        return {
          dot: icon(KIND_SVG.edit),
          tone: 'tl-edit-tone',
          body: [mono(event.path ?? event.text, event.path), ' ', h('span', { class: 'tl-add' }, `+${event.added ?? 0}`), ' ', h('span', { class: 'tl-del' }, `−${event.removed ?? 0}`)]
        }
      case 'command':
        return {
          dot: icon(KIND_SVG.command),
          tone: event.ok === false ? 'tl-bad' : '',
          body: [mono(event.command ?? event.text), event.ok === false ? h('span', { class: 'tl-fail-note' }, ' exited with an error') : null]
        }
      case 'test': {
        const failed = event.ok === false
        return {
          dot: icon(failed ? KIND_SVG.fail : KIND_SVG.pass),
          tone: failed ? 'tl-bad' : 'tl-good',
          body: [mono(event.command ?? 'tests'), ' ', h('span', { class: failed ? 'tl-bad-text' : 'tl-good-text' }, ...highlighted(event.text, q))]
        }
      }
      case 'error':
        return { dot: icon(KIND_SVG.error), tone: 'tl-bad', body: [h('span', { class: 'tl-bad-text' }, ...highlighted(event.text, q))] }
      case 'approval':
        return {
          dot: icon(KIND_SVG.allow),
          tone: event.allowed ? 'tl-good' : 'tl-bad',
          body: [h('b', {}, event.allowed ? 'Allowed' : 'Denied'), ' ', h('span', { class: 'muted' }, 'from this app'), event.text ? h('div', { class: 'tl-quote' }, ...highlighted(event.text, q)) : null]
        }
      case 'state':
        return { dot: event.state ? stateIcon(event.state) : icon(''), tone: '', body: [h('b', {}, event.state ? stateWord(event.state) : event.text)] }
    }
  }

  private async exportMarkdown(): Promise<void> {
    const view = this.view
    if (!view) return
    const events = this.events()
    const now = Math.max(view.now, Date.now())
    const text = renderTimelineMarkdown({
      title: this.past?.session.title ?? view.title,
      events,
      insights: computeInsights(events, now),
      span: timelineSpan(events, now, view.status !== 'exited' && this.past === null),
      prompts: events.filter((event) => event.kind === 'prompt').length,
      costUsd: this.past ? null : view.info.costUsd
    })
    const name = timelineFileName(view.project?.name ?? basename(this.folder()), new Date())
    const result = await api.exportTimeline({ name, text })
    if (result.status === 'saved') toast(`Timeline saved to ${result.path}`, 'info')
    else if (result.status === 'error') toast(`Could not export the timeline: ${result.message}`)
  }
}
