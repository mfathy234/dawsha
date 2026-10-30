import { AGENT_NAMES, agentLabel } from '../../shared/agents'
import {
  USAGE_RANGES,
  formatTokens,
  formatUsd,
  type UsageRange,
  type UsageReport
} from '../../shared/usage'
import { limitPace, paceText, resetText } from '../../shared/usageLimits'
import {
  busiestBucket,
  changeText,
  nextSort,
  percentChange,
  previousTotals,
  sortRows,
  totalsOf,
  type SortState,
  type UsageTotals
} from '../../shared/usageSummary'
import { api } from '../api'
import { clear, h } from '../dom'
import type { AppState } from '../state'
import { agentMark } from './agentMark'
import { buildBars, buildLegend, type ChartMode } from './usageChart'
import { pageHeader } from './pageHeader'

const REFRESH_MS = 30_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const NOT_REPORTED = 'not reported'

type ProjectKey = 'project' | 'sessions' | 'tokens' | 'cost' | 'agent'
type AgentSortKey = 'agent' | 'sessions' | 'tokens' | 'cacheRead' | 'cost'

const LIMIT_METERS = [
  { key: 'five_hour', label: '5-hour window' },
  { key: 'seven_day', label: 'Weekly' }
]

const muted = (text: string): HTMLElement => h('span', { class: 'usage-muted' }, text)

const cost = (value: number | null): Node | string => (value === null ? muted(NOT_REPORTED) : formatUsd(value))

function busiestLabel(key: string, hourly: boolean): string {
  if (hourly) return `${key.slice(11)}:00`
  const [year, month, day] = key.split('-').map(Number)
  return `${WEEKDAYS[new Date(year, month - 1, day).getDay()]} ${day}`
}


function notesFor(report: UsageReport): string[] {
  const notes: string[] = []
  for (const source of report.sources) {
    if (!source.found) notes.push(`No ${agentLabel(source.agent)} history found, so it is not counted.`)
  }
  if (report.sources.some((s) => s.found && s.agent !== 'claude')) {
    notes.push('Codex and Gemini report tokens only, so they have no cost.')
  }
  if (!report.hasCost) {
    notes.push('Cost appears for Claude Code sessions once Show live session info is on (Theme popover).')
  } else {
    notes.push("Cost counts on the day of a session's last report. Tokens leave out cache reads.")
  }
  return notes
}

export class UsageViewComponent {
  readonly el = h('main', { class: 'usage-view', 'aria-label': 'Usage' })
  private range: UsageRange = '7d'
  private mode: ChartMode = 'tokens'
  private report: UsageReport | null = null
  private longer: UsageReport | null = null
  private state: AppState | null = null
  private projectSort: SortState<ProjectKey> = { key: 'tokens', direction: 'desc' }
  private agentSort: SortState<AgentSortKey> = { key: 'tokens', direction: 'desc' }
  private error: string | null = null
  private loading = false
  private visible = false
  private token = 0
  private timer: number | undefined

  update(state: AppState): void {
    this.state = state
    const visible = state.view === 'usage'
    if (visible === this.visible) return
    this.visible = visible
    window.clearInterval(this.timer)
    if (!visible) return
    this.render()
    void this.load()
    this.timer = window.setInterval(() => void this.load(), REFRESH_MS)
  }

  private async load(): Promise<void> {
    const token = ++this.token
    this.loading = true
    this.updateBusy()
    try {
      const range = this.range
      const [report, longer] = await Promise.all([
        api.usageReport(range),
        range === '7d' ? api.usageReport('30d').catch(() => null) : Promise.resolve(null)
      ])
      if (token !== this.token) return
      this.report = report
      this.longer = longer
      this.error = null
    } catch (error) {
      if (token !== this.token) return
      this.error = (error as Error).message || 'Could not read the usage data.'
    }
    this.loading = false
    this.render()
  }

  private updateBusy(): void {
    this.el.setAttribute('aria-busy', String(this.loading))
  }

  private setRange(range: UsageRange): void {
    if (range === this.range) return
    this.range = range
    this.report = null
    this.longer = null
    this.render()
    void this.load()
  }

  private setMode(mode: ChartMode): void {
    this.mode = mode
    this.render()
  }

  private render(): void {
    clear(this.el)
    this.updateBusy()
    this.el.append(this.header())
    if (this.error) this.el.append(h('p', { class: 'field-error usage-error', role: 'alert' }, this.error))
    if (!this.report) {
      this.el.append(h('p', { class: 'usage-empty' }, this.error ? '' : "Reading your agents' history..."))
      return
    }
    this.el.append(
      this.tiles(this.report),
      this.chartPanel(this.report),
      this.limitPanel(this.report),
      this.tables(this.report),
      this.notes(this.report)
    )
  }

  private header(): HTMLElement {
    const tab = (range: UsageRange, label: string): HTMLElement =>
      h(
        'button',
        {
          class: `rp-tab${this.range === range ? ' selected' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': String(this.range === range),
          'data-range': range,
          onClick: () => this.setRange(range)
        },
        label
      )
    return pageHeader({
      title: 'Usage',
      subtitle: "Read from your agents' folders. Nothing leaves this computer.",
      actions: h('div', { class: 'rp-tabs', role: 'tablist', 'aria-label': 'Range' }, ...USAGE_RANGES.map((entry) => tab(entry.value, entry.label)))
    })
  }

  private tiles(report: UsageReport): HTMLElement {
    const totals = totalsOf(report)
    const previous = previousTotals(this.range, this.longer)
    const tile = (label: string, value: Node | string, note: string | null, id: string): HTMLElement =>
      h(
        'div',
        { class: 'usage-tile', id },
        h('span', { class: 'usage-tile-label' }, label),
        h('span', { class: 'usage-tile-value' }, value),
        h('span', { class: 'usage-tile-note' }, note)
      )
    const spendNote = totals.costUsd === null ? null : changeText(percentChange(totals.costUsd, previous?.costUsd ?? null))
    const tokenChange = changeText(percentChange(totals.tokens, previous?.tokens ?? null))
    const cacheNote = totals.cacheRead > 0 ? `${formatTokens(totals.cacheRead)} cache reads` : null
    const busiest = busiestBucket(report)
    return h(
      'div',
      { class: 'usage-tiles', role: 'group', 'aria-label': 'Summary' },
      tile('Spend', totals.costUsd === null ? muted(NOT_REPORTED) : formatUsd(totals.costUsd), spendNote, 'usage-tile-spend'),
      tile('Tokens', formatTokens(totals.tokens), tokenChange ? [tokenChange, cacheNote].filter(Boolean).join(' · ') : cacheNote, 'usage-tile-tokens'),
      tile('Sessions', String(totals.sessions), this.sessionsNote(report, totals), 'usage-tile-sessions'),
      tile(
        report.hourly ? 'Busiest hour' : 'Busiest day',
        busiest ? busiestLabel(busiest.key, report.hourly) : muted('none yet'),
        busiest ? `${formatTokens(busiest.tokens)} tokens` : null,
        'usage-tile-busiest'
      )
    )
  }

  private sessionsNote(report: UsageReport, totals: UsageTotals): string | null {
    if (totals.sessions === 0) return null
    return report.byAgent
      .filter((row) => row.sessions > 0)
      .map((row) => `${row.sessions} ${AGENT_NAMES[row.agent]}`)
      .join(', ')
  }

  private chartPanel(report: UsageReport): HTMLElement {
    const modeButton = (mode: ChartMode, label: string): HTMLElement =>
      h(
        'button',
        {
          class: `seg-btn${this.mode === mode ? ' on' : ''}`,
          type: 'button',
          role: 'radio',
          'aria-checked': String(this.mode === mode),
          'data-mode': mode,
          onClick: () => this.setMode(mode)
        },
        label
      )
    const title = `${this.mode === 'tokens' ? 'Tokens' : 'Cost'} per ${report.hourly ? 'hour' : 'day'}`
    const empty =
      this.mode === 'cost' && !report.hasCost
        ? 'No cost was reported in this range. Claude Code only shares cost through Show live session info.'
        : !report.hasTokens && this.mode === 'tokens'
          ? 'No usage found in this range.'
          : null
    return h(
      'section',
      { class: 'usage-panel', 'aria-label': title },
      h(
        'div',
        { class: 'usage-panel-head' },
        h('h2', {}, title),
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Chart unit' }, modeButton('tokens', 'Tokens'), modeButton('cost', 'Cost')),
        h('span', { class: 'spacer' }),
        buildLegend()
      ),
      empty ? h('p', { class: 'usage-empty', id: 'usage-chart-empty' }, empty) : buildBars(report, this.mode)
    )
  }

  private liveWindows(): Map<string, { percent: number; resetsAt: number | null; at: number }> {
    const found = new Map<string, { percent: number; resetsAt: number | null; at: number }>()
    for (const info of Object.values(this.state?.statusInfo ?? {})) {
      for (const window of info.rateLimits) {
        const known = found.get(window.key)
        if (!known || info.receivedAt > known.at) found.set(window.key, { percent: window.percent, resetsAt: window.resetsAt, at: info.receivedAt })
      }
    }
    return found
  }

  private limitPanel(report: UsageReport): HTMLElement {
    const head = h('h2', {}, 'Claude limits right now')
    const live = this.liveWindows()
    const now = Date.now()
    const meters = LIMIT_METERS.flatMap((meter) => {
      const series = report.limits.find((entry) => entry.key === meter.key)
      const liveWindow = live.get(meter.key)
      const lastPoint = series?.points[series.points.length - 1]
      const percent = liveWindow?.percent ?? lastPoint?.percent
      if (percent === undefined) return []
      const resetsAt = liveWindow?.resetsAt ?? null
      const pace = paceText(limitPace(series?.points ?? [], resetsAt, now))
      return [this.meter(meter, percent, resetsAt, pace, now)]
    })
    if (meters.length === 0) {
      return h(
        'section',
        { class: 'usage-panel', 'aria-label': 'Claude limits right now' },
        head,
        h(
          'p',
          { class: 'usage-empty', id: 'usage-limits-empty' },
          'No limit readings yet. Dawsha records the 5-hour and weekly limits while Show live session info is on.'
        )
      )
    }
    return h('section', { class: 'usage-panel', id: 'usage-limits', 'aria-label': 'Claude limits right now' }, head, h('div', { class: 'usage-meters' }, ...meters))
  }

  private meter(meter: { key: string; label: string }, percent: number, resetsAt: number | null, pace: string | null, now: number): HTMLElement {
    const rounded = Math.round(percent)
    return h(
      'div',
      { class: 'usage-meter', 'data-limit': meter.key, role: 'meter', 'aria-label': `${meter.label} used`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': rounded },
      h(
        'div',
        { class: 'usage-meter-head' },
        h('span', { class: 'usage-meter-label' }, meter.label),
        h('span', { class: 'usage-meter-percent' }, `${rounded}% used`)
      ),
      h('div', { class: 'usage-meter-foot' }, h('span', {}, resetText(resetsAt, now)), pace ? h('span', { class: 'usage-meter-pace' }, pace) : null)
    )
  }

  private sortHead<K extends string>(
    table: string,
    sort: SortState<K>,
    columns: { key: K; label: string; num?: boolean }[],
    onSort: (key: K) => void
  ): HTMLElement {
    const ariaSort = (key: K): string => (sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none')
    const arrow = (key: K): string => (sort.key === key ? (sort.direction === 'asc' ? '▲' : '▼') : '')
    return h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...columns.map((column) =>
          h(
            'th',
            { class: column.num ? 'num' : '', scope: 'col', 'aria-sort': ariaSort(column.key) },
            h(
              'button',
              { class: 'usage-sort', type: 'button', 'data-sort': `${table}:${column.key}`, onClick: () => onSort(column.key) },
              column.label,
              h('span', { class: 'usage-sort-arrow', 'aria-hidden': 'true' }, arrow(column.key))
            )
          )
        )
      )
    )
  }

  private resort(table: string, key: string, apply: () => void): void {
    apply()
    this.render()
    this.el.querySelector<HTMLElement>(`[data-sort="${table}:${key}"]`)?.focus()
  }

  private tables(report: UsageReport): HTMLElement {
    const projectRows = sortRows(report.byProject, this.projectSort, (row, key) =>
      key === 'project' ? row.project : key === 'sessions' ? row.sessions : key === 'tokens' ? row.tokens : key === 'cost' ? row.costUsd : row.topAgent
    ).map((row) =>
      h(
        'tr',
        { 'data-project': row.project },
        h('td', {}, row.project),
        h('td', { class: 'num' }, String(row.sessions)),
        h('td', { class: 'num' }, formatTokens(row.tokens)),
        h('td', { class: 'num' }, cost(row.costUsd)),
        h('td', {}, row.topAgent ? h('span', { class: 'usage-top' }, agentMark(row.topAgent), AGENT_NAMES[row.topAgent]) : '')
      )
    )
    const agentRows = sortRows(report.byAgent, this.agentSort, (row, key) =>
      key === 'agent' ? agentLabel(row.agent) : key === 'sessions' ? row.sessions : key === 'tokens' ? row.tokens : key === 'cacheRead' ? row.cacheRead : row.costUsd
    ).map((row) =>
      h(
        'tr',
        { 'data-agent': row.agent },
        h('td', {}, h('span', { class: 'usage-top' }, agentMark(row.agent), agentLabel(row.agent))),
        h('td', { class: 'num' }, String(row.sessions)),
        h('td', { class: 'num' }, formatTokens(row.tokens)),
        h('td', { class: 'num' }, formatTokens(row.cacheRead)),
        h('td', { class: 'num' }, cost(row.costUsd))
      )
    )
    const projectHead = this.sortHead<ProjectKey>(
      'project',
      this.projectSort,
      [
        { key: 'project', label: 'Project' },
        { key: 'sessions', label: 'Sessions', num: true },
        { key: 'tokens', label: 'Tokens', num: true },
        { key: 'cost', label: 'Cost', num: true },
        { key: 'agent', label: 'Top agent' }
      ],
      (key) => this.resort('project', key, () => (this.projectSort = nextSort(this.projectSort, key, ['project', 'agent'])))
    )
    const agentHead = this.sortHead<AgentSortKey>(
      'agent',
      this.agentSort,
      [
        { key: 'agent', label: 'Agent' },
        { key: 'sessions', label: 'Sessions', num: true },
        { key: 'tokens', label: 'Tokens', num: true },
        { key: 'cacheRead', label: 'Cache read', num: true },
        { key: 'cost', label: 'Cost', num: true }
      ],
      (key) => this.resort('agent', key, () => (this.agentSort = nextSort(this.agentSort, key, ['agent'])))
    )
    return h(
      'div',
      { class: 'usage-tables' },
      h(
        'section',
        { class: 'usage-panel', 'aria-label': 'By project' },
        h('h2', {}, 'By project'),
        projectRows.length === 0
          ? h('p', { class: 'usage-empty' }, 'No projects used in this range.')
          : h('table', { class: 'usage-table', id: 'usage-by-project' }, projectHead, h('tbody', {}, ...projectRows))
      ),
      h(
        'section',
        { class: 'usage-panel', 'aria-label': 'By agent' },
        h('h2', {}, 'By agent'),
        h('table', { class: 'usage-table', id: 'usage-by-agent' }, agentHead, h('tbody', {}, ...agentRows))
      )
    )
  }

  private notes(report: UsageReport): HTMLElement {
    return h('ul', { class: 'usage-notes' }, ...notesFor(report).map((note) => h('li', {}, note)))
  }
}
