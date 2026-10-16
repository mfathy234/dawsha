import { selectMenu, syncSelectMenu } from '../selectMenu'
import type { OrchRunDetail } from '../../../shared/orch/api'
import { totalCostLabel } from '../../../shared/orch/board'
import { historyResult, historyRuns, type HistoryFilter } from '../../../shared/orch/history'
import { clear, h } from '../../dom'
import { exportHistoryRun, exportHistoryRuns, importHistoryRuns, showOrch } from '../../orchActions'
import type { AppState } from '../../state'
import { pill } from './orchUi'
import './historyView.css'

/** Past runs remain searchable and inspectable without starting any agent work. */
export class OrchHistoryView {
  readonly el = h('section', { class: 'orch-section orch-history', 'aria-label': 'Run history' })
  private readonly search = h('input', { class: 'orch-search', type: 'search', id: 'orch-history-search', placeholder: 'Stories, tasks, decisions…' })
  private readonly project = h('select', { class: 'orch-select', id: 'orch-history-project' })
  private readonly result = h('select', { class: 'orch-select', id: 'orch-history-result' },
    ...[['', 'All results'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['imported', 'Imported']].map(([value, label]) => h('option', { value }, label)))
  private readonly export = h('button', { class: 'btn', type: 'button', disabled: true }, 'Export selected (0)')
  private readonly import = h('button', { class: 'btn', type: 'button' }, 'Import runs…')
  private readonly host = h('div', { class: 'orch-history-content' })
  private filter: HistoryFilter = { query: '', project: '', result: '' }
  private selected = new Set<string>()
  private activeId: string | null = null
  private state: AppState | null = null
  private signature = ''
  private projectSignature = ''
  private busy = false

  constructor() {
    const label = (text: string, input: HTMLElement): HTMLElement => h('div', { class: 'orch-filter' }, h('label', { class: 'orch-filter-label', for: input.id }, text), input instanceof HTMLSelectElement ? selectMenu(input) : input)
    this.el.append(h('div', { class: 'orch-history-toolbar' }, h('div', {}, h('h2', {}, 'Run history'), h('p', { class: 'orch-muted' }, 'Finished, cancelled and imported runs, all projects')),
      h('div', { class: 'orch-actions' }, this.import, this.export)),
      h('div', { class: 'orch-filterbar orch-panel' }, label('Search history', this.search), label('Project', this.project), label('Result', this.result)), this.host)
    this.search.addEventListener('input', () => this.setFilter({ query: this.search.value }))
    this.project.addEventListener('change', () => this.setFilter({ project: this.project.value }))
    this.result.addEventListener('change', () => this.setFilter({ result: this.result.value }))
    this.import.addEventListener('click', () => void this.action(() => importHistoryRuns()))
    this.export.addEventListener('click', () => void this.action(() => exportHistoryRuns([...this.selected])))
  }

  update(state: AppState): void {
    this.state = state
    const all = historyRuns(state.orch?.runs ?? [], { query: '', project: '', result: '' })
    this.selected = new Set([...this.selected].filter((id) => all.some((r) => r.id === id)))
    this.syncButtons()
    const projects = [...new Set(all.map((r) => r.projectPath))]
    const projectSignature = JSON.stringify([projects, state.settings.projects])
    if (projectSignature !== this.projectSignature) {
      this.projectSignature = projectSignature
      clear(this.project)
      this.project.append(h('option', { value: '' }, 'All projects'), ...projects.map((path) => h('option', { value: path }, this.projectName(path))))
      if (!projects.includes(this.filter.project)) this.filter = { ...this.filter, project: '' }
      this.project.value = this.filter.project
      syncSelectMenu(this.project)
    }
    const runs = historyRuns(all, this.filter)
    if (!runs.some((r) => r.id === this.activeId)) this.activeId = runs[0]?.id ?? null
    const signature = JSON.stringify([runs, this.selected.size, [...this.selected], this.activeId, this.busy, state.settings.orchestrator.plans])
    if (signature === this.signature) return
    this.signature = signature
    clear(this.host)
    if (!runs.length) {
      this.host.append(h('div', { class: 'orch-empty' }, h('h3', {}, all.length ? 'No matching runs' : 'No history yet'),
        h('p', {}, all.length ? 'Try another search or filter.' : 'Finish a run or import a .dawsharun file to see it here.')))
      return
    }
    const headers = ['', 'Story', 'Project', 'Plan', 'Result', 'Tasks', 'Decisions', 'Cost', 'Finished', 'Actions']
    const table = h('table', { class: 'orch-table' }, h('thead', {}, h('tr', {}, ...headers.map((text) => h('th', { scope: 'col' }, text || h('span', { class: 'sr-only' }, 'Select'))))),
      h('tbody', {}, ...runs.map((run) => this.row(run))))
    this.host.append(h('div', { class: 'orch-panel orch-scroll' }, table), this.details(runs.find((r) => r.id === this.activeId)!))
  }

  private projectName(path: string): string {
    return this.state?.settings.projects.find((p) => p.folder === path)?.name ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path
  }

  private setFilter(change: Partial<HistoryFilter>): void {
    this.filter = { ...this.filter, ...change }
    this.rerender()
  }

  private rerender(): void { this.signature = ''; if (this.state) this.update(this.state) }

  private syncButtons(): void {
    this.export.textContent = `Export selected (${this.selected.size})`
    this.export.disabled = this.busy || !this.selected.size
    this.import.disabled = this.busy
  }

  private async action(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return
    this.busy = true; this.rerender()
    try { await fn() } finally { this.busy = false; this.rerender() }
  }

  private row(run: OrchRunDetail): HTMLElement {
    const checkbox = h('input', { type: 'checkbox', 'aria-label': `Select ${run.title}` })
    checkbox.checked = this.selected.has(run.id)
    checkbox.addEventListener('change', () => {
      this.selected = new Set(checkbox.checked ? [...this.selected, run.id] : [...this.selected].filter((id) => id !== run.id))
      this.activeId = run.id; this.rerender()
    })
    const result = historyResult(run)
    const plan = this.state?.settings.orchestrator.plans.find((p) => p.id === run.plan)?.name ?? run.plan
    const at = run.finishedAt ?? run.imported?.at ?? run.createdAt
    return h('tr', { class: this.activeId === run.id ? 'selected' : '' }, h('td', {}, checkbox),
      h('td', {}, h('button', { type: 'button', class: 'orch-history-title', onClick: () => { this.activeId = run.id; this.rerender() } }, run.title),
        h('div', { class: 'orch-muted orch-history-sub' }, run.imported ? `imported from ${run.imported.from} · read-only` : `${result} · ${run.branch}`)),
      h('td', {}, this.projectName(run.projectPath)), h('td', {}, plan), h('td', {}, pill(result, result === 'cancelled' ? 'idle' : 'done')),
      h('td', { class: 'num' }, String(run.taskCount)), h('td', { class: 'num' }, String(run.decisions?.length ?? 0)),
      h('td', { class: 'num' }, totalCostLabel(run.usage.total.costUsd, run.usage.total.complete)),
      h('td', {}, h('time', { datetime: new Date(at).toISOString() }, new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))),
      h('td', {}, h('div', { class: 'orch-actions' }, h('button', { class: 'btn orch-small', type: 'button', onClick: () => showOrch('runs', run.id) }, 'Open'),
        h('button', { class: 'btn orch-small', type: 'button', disabled: this.busy, onClick: () => void this.action(() => exportHistoryRun(run.id, 'markdown')) }, 'Export as Markdown'))))
  }

  private details(run: OrchRunDetail): HTMLElement {
    return h('aside', { class: 'orch-history-details orch-panel', 'aria-label': 'Selected run details' },
      h('h3', {}, `${run.title} · what’s kept`), h('ul', {},
        ...['The story and plan', 'Every task with its reviews, rounds and final summaries', 'Your decisions, options and answers', 'Agent messages, notes and the full timeline', 'Runners, models and usage per agent'].map((text) => h('li', {}, text))),
      h('h3', {}, 'Export and import'), h('p', {}, 'Export saves one .dawsharun file per run. A Markdown report is also available.'),
      h('p', {}, 'Imported runs are read-only history. Agent credentials and local launch settings are left out.'))
  }
}
