import { AGENT_NAMES, agentLabel } from '../../shared/agents'
import {
  USAGE_RANGES,
  formatTokens,
  formatUsd,
  type UsageRange,
  type UsageReport
} from '../../shared/usage'
import { api } from '../api'
import { clear, h } from '../dom'
import type { AppState } from '../state'
import { agentMark } from './agentMark'
import { buildBars, buildLegend, buildLimitChart, type ChartMode } from './usageChart'

const REFRESH_MS = 30_000

const cost = (value: number | null): string => (value === null ? 'n/a' : formatUsd(value))

function notesFor(report: UsageReport): string[] {
  const notes: string[] = []
  for (const source of report.sources) {
    if (!source.found) notes.push(`No ${agentLabel(source.agent)} history was found on this computer, so it is not counted.`)
  }
  if (report.sources.some((s) => s.found && s.agent !== 'claude')) {
    notes.push('Codex and Gemini write token counts only, so they have no cost here.')
  }
  if (!report.hasCost) {
    notes.push(
      'Cost is shown for Claude Code sessions that reported one through Show live session info (Theme popover). Dawsha keeps the last cost of each session, so older days stay available.'
    )
  } else {
    notes.push('Claude Code cost is counted on the day of each session\'s last cost report. Tokens count input, output and cache writes; cache reads are listed apart.')
  }
  return notes
}

export class UsageViewComponent {
  readonly el = h('main', { class: 'usage-view', 'aria-label': 'Usage' })
  private range: UsageRange = '7d'
  private mode: ChartMode = 'tokens'
  private report: UsageReport | null = null
  private error: string | null = null
  private loading = false
  private visible = false
  private token = 0
  private timer: number | undefined

  update(state: AppState): void {
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
      const report = await api.usageReport(this.range)
      if (token !== this.token) return
      this.report = report
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
      this.el.append(h('p', { class: 'usage-empty' }, this.error ? '' : 'Reading your agents\' history...'))
      return
    }
    this.el.append(this.chartPanel(this.report), this.limitPanel(this.report), this.tables(this.report), this.notes(this.report))
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
    return h(
      'div',
      { class: 'usage-head' },
      h('h1', {}, 'Usage'),
      h('div', { class: 'rp-tabs', role: 'tablist', 'aria-label': 'Range' }, ...USAGE_RANGES.map((entry) => tab(entry.value, entry.label))),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted usage-local' }, 'Read from your agents\' own folders. Nothing leaves this computer.')
    )
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

  private limitPanel(report: UsageReport): HTMLElement {
    const head = h('h2', {}, 'Limit usage')
    if (report.limits.length === 0) {
      return h(
        'section',
        { class: 'usage-panel', 'aria-label': 'Limit usage' },
        head,
        h(
          'p',
          { class: 'usage-empty', id: 'usage-limits-empty' },
          'No limit readings in this range. Dawsha records the 5 hour and weekly limit whenever Claude Code reports it through Show live session info, so the history starts from the day you turn that on.'
        )
      )
    }
    const legend = h(
      'div',
      { class: 'usage-legend' },
      ...report.limits.map((series, index) => {
        const last = series.points[series.points.length - 1]
        return h('span', { class: 'usage-key' }, h('span', { class: `usage-swatch usage-line-${index}` }), `${series.label}, now ${Math.round(last.percent)}%`)
      })
    )
    return h(
      'section',
      { class: 'usage-panel', 'aria-label': 'Limit usage' },
      h('div', { class: 'usage-panel-head' }, head, h('span', { class: 'spacer' }), legend),
      buildLimitChart(report, report.limits) as unknown as HTMLElement
    )
  }

  private tables(report: UsageReport): HTMLElement {
    const projects = report.byProject.map((row) =>
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
    const agents = report.byAgent.map((row) =>
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
    const head = (...labels: string[]): HTMLElement =>
      h('thead', {}, h('tr', {}, ...labels.map((label, index) => h('th', { class: index > 0 && label !== 'Top agent' ? 'num' : '' }, label))))
    return h(
      'div',
      { class: 'usage-tables' },
      h(
        'section',
        { class: 'usage-panel', 'aria-label': 'By project' },
        h('h2', {}, 'By project'),
        projects.length === 0
          ? h('p', { class: 'usage-empty' }, 'No projects used in this range.')
          : h('table', { class: 'usage-table', id: 'usage-by-project' }, head('Project', 'Sessions', 'Tokens', 'Cost', 'Top agent'), h('tbody', {}, ...projects))
      ),
      h(
        'section',
        { class: 'usage-panel', 'aria-label': 'By agent' },
        h('h2', {}, 'By agent'),
        h('table', { class: 'usage-table', id: 'usage-by-agent' }, head('Agent', 'Sessions', 'Tokens', 'Cache read', 'Cost'), h('tbody', {}, ...agents))
      )
    )
  }

  private notes(report: UsageReport): HTMLElement {
    return h('ul', { class: 'usage-notes' }, ...notesFor(report).map((note) => h('li', {}, note)))
  }
}
