import { api } from '../api'
import { clear, h } from '../dom'
import { filterSkills, skillExportLabel, skillExportSummary } from '../../shared/skillSearch'
import type { SkillEntry } from '../../shared/skills'

type Filter = 'all' | SkillEntry['agent']
type Kind = SkillEntry['kind']

export class SkillsViewComponent {
  readonly el = h('main', { class: 'skills-view', 'aria-label': 'Skills' })
  private readonly rows = h('div', { class: 'skill-list' })
  private readonly status = h('p', { class: 'skill-status', role: 'status' })
  private readonly filters = h('div', { class: 'skill-filters', role: 'group', 'aria-label': 'Filter by AI provider' })
  private readonly kinds = h('div', { class: 'skill-kinds', role: 'group', 'aria-label': 'Inventory type' })
  private readonly search = h('input', {
    class: 'skill-search',
    type: 'search',
    placeholder: 'Search by name, path or project',
    'aria-label': 'Search skills and agents',
    onInput: () => this.render()
  })
  private readonly exportShown = h('button', { class: 'btn small', type: 'button', 'data-skill-export-shown': '', onClick: () => void this.exportVisible() })
  private readonly exportStatus = h('span', { class: 'skill-feedback', role: 'status' })
  private visible: SkillEntry[] = []
  private entries: SkillEntry[] = []
  private filter: Filter = 'all'
  private kind: Kind = 'skill'
  private loaded = false

  constructor() {
    for (const [kind, label] of [['skill', 'Installed skills'], ['agent', 'Installed agents']] as const) {
      this.kinds.append(h('button', {
        class: 'skill-kind', type: 'button', 'data-kind': kind,
        onClick: () => { this.kind = kind; this.render() }
      }, label))
    }
    for (const filter of ['all', 'claude', 'codex', 'gemini', 'shared'] as Filter[]) {
      this.filters.append(h('button', {
        class: 'btn ghost small', type: 'button',
        'data-skill-filter': filter,
        onClick: () => { this.filter = filter; this.render() }
      }, filter === 'all' ? 'All' : filter[0].toUpperCase() + filter.slice(1)))
    }
    this.el.append(
      h('div', { class: 'skills-head' },
        h('div', {}, h('h1', {}, 'Skills'), h('p', { class: 'lede' }, 'Skills and agent definitions installed on this machine or in your projects.')),
        h('button', { class: 'btn ghost', type: 'button', onClick: () => void this.refresh() }, 'Refresh')
      ),
      this.kinds,
      h('div', { class: 'skill-toolbar' }, this.filters, this.search, this.exportShown, this.exportStatus),
      this.status,
      this.rows
    )
  }

  show(): void {
    if (!this.loaded) void this.refresh()
  }

  private async refresh(): Promise<void> {
    this.status.textContent = 'Scanning installed skills and agents…'
    try {
      this.entries = await api.listSkills()
      this.loaded = true
      this.status.textContent = ''
      this.render()
    } catch {
      this.status.textContent = 'Could not scan installed items. Try Refresh.'
    }
  }

  private render(): void {
    for (const button of this.kinds.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.getAttribute('data-kind') === this.kind))
    for (const button of this.filters.querySelectorAll('button')) {
      const filter = button.getAttribute('data-skill-filter')
      button.setAttribute('aria-pressed', String(filter === this.filter))
      button.setAttribute('aria-label', `${filter === 'all' ? 'All' : filter === 'shared' ? 'Shared' : filter![0].toUpperCase() + filter!.slice(1)} ${this.kind === 'skill' ? 'skills' : 'agents'}`)
    }
    const entries = filterSkills(this.entries, { kind: this.kind, agent: this.filter, query: this.search.value })
    this.visible = entries
    this.exportShown.textContent = skillExportLabel(entries.length, this.kind, this.filter)
    this.exportShown.disabled = entries.length === 0
    clear(this.rows)
    const why = this.search.value.trim() ? 'this search' : 'this filter'
    if (this.loaded && entries.length === 0) this.rows.append(h('p', { class: 'skill-empty' }, `No ${this.kind === 'skill' ? 'skills' : 'agents'} found for ${why}.`))
    for (const entry of entries) this.rows.append(this.row(entry))
  }

  private async exportVisible(): Promise<void> {
    const ids = this.visible.map((entry) => entry.id)
    if (ids.length === 0) return
    this.exportStatus.textContent = ''
    this.exportShown.disabled = true
    try {
      const result = await api.exportSkills(ids)
      if (result) this.exportStatus.textContent = skillExportSummary(result)
    } catch (error) {
      this.exportStatus.textContent = error instanceof Error ? error.message : 'Export failed.'
    } finally {
      this.exportShown.disabled = this.visible.length === 0
    }
  }

  private row(entry: SkillEntry): HTMLElement {
    const feedback = h('span', { class: 'skill-feedback', role: 'status' })
    const run = async (action: () => Promise<unknown>, success: string): Promise<void> => {
      feedback.textContent = ''
      try { const result = await action(); feedback.textContent = result === null ? '' : success } catch (error) { feedback.textContent = error instanceof Error ? error.message : 'Action failed.' }
    }
    return h('article', { class: 'skill-row', 'data-agent': entry.agent, 'data-kind': entry.kind },
      h('div', { class: 'skill-details' },
        h('strong', {}, entry.name),
        h('span', { class: 'skill-meta' }, `${entry.agent} · ${entry.scope}${entry.project ? ` · ${entry.project}` : ''}`),
        h('span', { class: 'skill-path', title: entry.path }, entry.path)
      ),
      h('div', { class: 'skill-actions' },
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => void run(() => api.openSkill(entry.id), 'Opened') }, 'Open'),
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => void run(() => api.writeClipboard(entry.path), 'Copied') }, 'Copy path'),
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => void run(() => api.exportSkill(entry.id), 'Export complete') }, 'Export'),
        feedback
      )
    )
  }
}
