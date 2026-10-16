import { WORK_TYPES, WORK_LABELS, type WorkItem, type WorkPeriod, type WorkReport } from '../../shared/workDashboard'
import { agentLabel } from '../../shared/agents'
import { api } from '../api'
import { resumeInNewPane } from '../actions'
import { refreshOrch, showOrch } from '../orchActions'
import { h } from '../dom'
import type { AppState } from '../state'
import { buildStackedBars } from './usageChart'
import { present } from './dialogs'
import { store } from '../state'
import './workView.css'

const PERIODS: { value: WorkPeriod; label: string }[] = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]
const duration = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export class WorkViewComponent {
  readonly el = h('main', { class: 'work-view', 'aria-label': 'Work dashboard' })
  private period: WorkPeriod = 'today'
  private report: WorkReport | null = null
  private projectId: string | null = null
  private visible = false
  private loading = false
  private error: string | null = null
  private token = 0
  private timer: number | undefined

  update(state: AppState): void {
    const visible = state.view === 'work'
    if (visible === this.visible) return
    this.visible = visible
    window.clearInterval(this.timer)
    if (!visible) { this.token++; return }
    void this.load()
    this.timer = window.setInterval(() => void this.load(), 30_000)
  }

  private async load(): Promise<void> {
    const token = ++this.token
    this.loading = true
    this.render()
    try {
      const report = await api.workReport(this.period)
      if (token !== this.token) return
      this.report = report
      this.error = null
      if (!report.projects.some(p => p.projectId === this.projectId)) this.projectId = null
    } catch {
      if (token !== this.token) return
      this.error = 'Could not read your work history. Try refreshing.'
    }
    this.loading = false
    this.render()
  }

  private changePeriod(period: WorkPeriod): void {
    if (period === this.period) return
    this.period = period
    this.report = null
    this.projectId = null
    void this.load()
  }

  private render(): void {
    this.el.setAttribute('aria-busy', String(this.loading))
    this.el.replaceChildren(h('div', { class: 'usage-head' },
      h('h1', {}, 'Work'),
      h('div', { class: 'rp-tabs', role: 'tablist', 'aria-label': 'Work period' }, ...PERIODS.map(p => h('button', {
        class: `rp-tab${this.period === p.value ? ' selected' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(this.period === p.value),
        onClick: () => this.changePeriod(p.value)
      }, p.label))), h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', type: 'button', disabled: this.loading, onClick: () => void this.load() }, 'Refresh')))
    if (this.error) this.el.append(h('p', { class: 'field-error', role: 'alert' }, this.error))
    const report = this.report
    if (!report) {
      if (this.loading) this.el.append(h('p', { class: 'usage-empty', role: 'status' }, 'Reading your work history…'))
      return
    }
    const tile = (id: string, label: string, count: number) => h('div', { class: 'usage-tile', id: `work-${id}` },
      h('span', { class: 'usage-tile-label' }, label), h('span', { class: 'usage-tile-value' }, String(count)))
    this.el.append(h('div', { class: 'usage-tiles work-tiles', role: 'group', 'aria-label': 'Work summary' },
      ...WORK_TYPES.map(type => tile(type, WORK_LABELS[type], report.counts[type])), tile('total', 'Total', report.total)))
    if (report.total === 0) {
      this.el.append(h('p', { class: 'usage-empty' }, 'No work in this period. Sessions in your Dawsha projects and orchestrator runs appear here.'))
      return
    }
    if (this.period !== 'today') this.el.append(this.chart(report))
    this.el.append(this.projects(report), this.items(report), h('p', { class: 'usage-local muted' },
      'One item per session or orchestrator run, counted on its last activity day. Time is elapsed first-to-last activity, not active coding time. Missing branches stay unknown; commit evidence uses the current checkout when no branch was recorded.'))
  }

  private chart(report: WorkReport): HTMLElement {
    return h('section', { class: 'usage-panel', 'aria-label': 'Items per day' },
      h('div', { class: 'usage-panel-head' }, h('h2', {}, 'Items per day'), h('span', { class: 'spacer' }),
        h('div', { class: 'usage-legend' }, ...WORK_TYPES.map(type => h('span', { class: 'usage-key' }, h('span', { class: `usage-swatch work-${type}` }), WORK_LABELS[type])))),
      buildStackedBars(report.buckets.map((b, i) => ({ key: b.key,
        label: report.buckets.length <= 7 ? new Date(`${b.key}T12:00:00`).toLocaleDateString([], { weekday: 'short' }) : i % 5 === 0 || i === report.buckets.length - 1 ? String(Number(b.key.slice(-2))) : '',
        title: `${b.key}: ${WORK_TYPES.map(t => `${WORK_LABELS[t]} ${b.counts[t]}`).join(', ')}`,
        segments: WORK_TYPES.map(t => ({ className: `work-${t}`, value: b.counts[t] }))
      })), n => String(n)))
  }

  private projects(report: WorkReport): HTMLElement {
    return h('section', { class: 'usage-panel work-projects', 'aria-label': 'Per project' }, h('h2', {}, 'Per project'),
      h('div', { class: 'work-table-scroll' }, h('table', { class: 'usage-table', id: 'work-by-project' },
        h('thead', {}, h('tr', {}, ...['Project', ...WORK_TYPES.map(t => WORK_LABELS[t]), 'Total', 'Time spent'].map((text, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, text)))),
        h('tbody', {}, ...report.projects.map(row => h('tr', { 'data-project': row.projectId },
          h('td', {}, h('button', { class: 'usage-sort', type: 'button', 'aria-label': `Filter by ${row.project}`, 'aria-pressed': String(this.projectId === row.projectId), onClick: () => { this.projectId = this.projectId === row.projectId ? null : row.projectId; this.render() } }, row.project)),
          ...WORK_TYPES.map(t => h('td', { class: 'num' }, String(row.counts[t]))), h('td', { class: 'num' }, String(row.total)), h('td', { class: 'num' }, duration(row.durationMs))))))))
  }

  private items(report: WorkReport): HTMLElement {
    const items = report.items.filter(item => !this.projectId || item.projectId === this.projectId)
    return h('section', { class: 'usage-panel', 'aria-label': 'Items' },
      h('div', { class: 'usage-panel-head' }, h('h2', {}, `Items · ${items.length}`), this.projectId ? h('button', { class: 'btn ghost', type: 'button', onClick: () => { this.projectId = null; this.render() } }, 'All projects') : null),
      h('ul', { class: 'work-items' }, ...items.map(item => this.item(item))))
  }

  private item(item: WorkItem): HTMLElement {
    return h('li', {}, h('button', { class: 'work-item', type: 'button', onClick: () => void this.open(item) },
      h('span', { class: 'work-item-main' }, h('strong', {}, item.title), h('span', { class: `work-chip work-${item.type}` }, WORK_LABELS[item.type]), item.ticket ? h('span', { class: 'work-ticket' }, item.ticket) : null),
      h('span', { class: 'work-item-meta' }, item.project, ' · ', item.agent === 'orchestrator' ? 'Orchestrator' : agentLabel(item.agent), ' · ', item.branch ?? 'Unknown branch',
        ' · ', new Date(item.endedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), ' · ', duration(item.endedAt - item.startedAt))))
  }

  private async open(item: WorkItem): Promise<void> {
    try {
      if (item.agent === 'orchestrator') {
        if (!store.state.settings.experimental.orchestrator) this.previewRun(item)
        else { await refreshOrch(); showOrch('runs', item.id) }
      }
      else if (item.session) await resumeInNewPane(item.session)
    } catch {
      this.error = 'Could not open this item. Its project may no longer be available.'
      this.render()
    }
  }

  private previewRun(item: WorkItem): void {
    const close = h('button', { class: 'btn ghost', type: 'button' }, 'Close')
    const dialog = h('div', { class: 'dialog work-run-preview', role: 'dialog', 'aria-modal': 'true', 'aria-label': item.title },
      h('h2', {}, item.title), h('p', { class: 'muted' }, `${item.project} · ${WORK_LABELS[item.type]} · ${item.run?.stage ?? ''}`),
      h('p', {}, item.branch, ' · ', duration(item.endedAt - item.startedAt)),
      h('p', {}, 'Saved run · read-only. The orchestrator remains off.'),
      item.run?.story ? h('p', { class: 'work-run-story' }, item.run.story) : null,
      item.run?.plan ? h('details', {}, h('summary', {}, 'Plan'), h('pre', {}, item.run.plan)) : null,
      h('div', { class: 'dialog-actions' }, close))
    const shown = present(dialog, null, close)
    close.addEventListener('click', () => shown.finish(null))
  }
}
