import { openChanges } from '../actions'
import { api } from '../api'
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
  type TimelineInsights
} from '../../shared/timeline'
import { formatTokens, formatUsd } from '../../shared/usage'
import { folderOfPane, paneById, store } from '../state'
import { closeTimeline, timelineRequest } from '../timelineActions'
import { localEvents } from '../timelineLog'
import { stateIcon } from './stateIcon'
import { toast } from './toast'

const REFRESH_MS = 4000
const NOW_BUCKET_MS = 30_000

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

  constructor(private readonly paneId: string) {
    const filterButtons = TIMELINE_FILTERS.map((entry) =>
      h('button', { class: 'tl-filter', type: 'button', 'data-filter': entry.id, 'aria-pressed': String(entry.id === this.filter), onClick: () => this.setFilter(entry.id) }, entry.label)
    )
    this.filters.append(...filterButtons)
    const close = h('button', { class: 'icon-btn tl-close', type: 'button', 'aria-label': 'Close timeline', title: 'Close timeline', onClick: () => closeTimeline() }, '×')
    const head = h('div', { class: 'tl-head' }, h('h2', {}, 'Timeline'), this.summary, h('span', { class: 'spacer' }), close)
    const searchRow = h('div', { class: 'tl-search-row' }, this.search, this.count, this.prev, this.next)
    const top = h('div', { class: 'tl-top' }, head, h('div', { class: 'tl-bar-wrap' }, this.bar, this.legend), this.filters, searchRow)
    const foot = h('div', { class: 'tl-foot' }, this.exportButton, h('span', { class: 'spacer' }), h('span', { class: 'tl-hint' }, 'Ctrl+Shift+T'))
    this.el = h('aside', { class: 'timeline-panel', 'aria-label': 'Timeline', hidden: true }, top, this.insights, h('div', { class: 'tl-scroll' }, this.list, this.empty), foot)
    this.search.addEventListener('input', () => {
      this.query = this.search.value
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

  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.opened = false
    this.token += 1
  }

  private tick(): void {
    if (!this.el.isConnected) return this.stop()
    void this.fetch()
  }

  private async fetch(): Promise<void> {
    const request = timelineRequest(this.paneId)
    const token = ++this.token
    if (!request) {
      this.loaded = 'none'
      this.log = []
      this.render(true)
      return
    }
    const result = await api.sessionTimeline(request).catch(() => null)
    if (token !== this.token || !this.opened) return
    if (result?.status === 'ok') {
      this.log = result.events
      this.loaded = 'ready'
    } else if (this.loaded === 'loading') {
      this.loaded = 'none'
    }
    this.render()
  }

  private folder(): string {
    const pane = paneById(store.state, this.paneId)
    return (pane ? folderOfPane(store.state, pane) : null) ?? ''
  }

  private events(): TimelineEvent[] {
    const folder = this.folder()
    return mergeTimeline(this.log, localEvents(this.paneId)).map((event) => relativeEvent(event, folder))
  }

  private visible(): TimelineEvent[] {
    return filterEvents(this.events(), this.filter)
  }

  private visibleHits(): number[] {
    return searchEvents(this.visible(), this.query)
  }

  private setFilter(filter: TimelineFilter): void {
    this.filter = filter
    this.matchAt = this.visibleHits().length > 0 ? 0 : -1
    this.revealMatch = true
    this.render(true)
  }

  private step(direction: 1 | -1): void {
    const hits = this.visibleHits()
    this.matchAt = stepMatch(hits.length, this.matchAt, direction)
    this.revealMatch = true
    this.render(true)
  }

  private onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.step(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (this.query !== '') {
        this.search.value = ''
        this.query = ''
        this.matchAt = -1
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
    const events = this.events()
    const shown = filterEvents(events, this.filter)
    const hits = searchEvents(shown, this.query)
    if (this.matchAt >= hits.length) this.matchAt = hits.length > 0 ? 0 : -1
    const cost = view.info.costUsd
    const tokens = view.info.tokens
    const signature = JSON.stringify([
      events.map((event) => [event.at, event.kind, event.text, event.ok, event.added, event.removed, event.passed, event.failed, event.allowed]),
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
    const live = view.status !== 'exited'
    const insights = computeInsights(events, now)
    this.renderHead(events, now, live, cost)
    this.renderBar(events, now)
    this.renderFilters()
    this.renderCount(hits.length)
    this.renderInsights(insights, cost, tokens)
    this.renderList(shown, hits)
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
    const active = hits[this.matchAt]
    const hitSet = new Set(hits)
    const rows = shown.map((event, index) => this.row(event, hitSet.has(index), index === active))
    this.list.replaceChildren(...rows)
    const message = this.emptyMessage(shown.length)
    this.empty.hidden = message === ''
    this.empty.textContent = message
    if (scroll) scroll.scrollTop = top
    if (this.revealMatch) {
      this.revealMatch = false
      rows[active]?.scrollIntoView({ block: 'nearest' })
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
      title: view.title,
      events,
      insights: computeInsights(events, now),
      span: timelineSpan(events, now, view.status !== 'exited'),
      prompts: events.filter((event) => event.kind === 'prompt').length,
      costUsd: view.info.costUsd
    })
    const name = timelineFileName(view.project?.name ?? basename(this.folder()), new Date())
    const result = await api.exportTimeline({ name, text })
    if (result.status === 'saved') toast(`Timeline saved to ${result.path}`, 'info')
    else if (result.status === 'error') toast(`Could not export the timeline: ${result.message}`)
  }
}
