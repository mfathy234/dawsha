import { api } from '../api'
import { h } from '../dom'
import { AGENT_NAMES, AGENTS } from '../../shared/agents'
import type { TimelineFilter } from '../../shared/timeline'
import type { SessionHits } from '../../shared/timelineSearch'
import type { AgentKind, ResumeSession } from '../../shared/types'
import { FilterMenu } from './filterMenu'
import { resultGroups, type ResultHandlers } from './timelineResults'

const DEBOUNCE_MS = 250

export interface AllSearchDeps extends ResultHandlers {
  paneId: string
  query(): string
  filter(): TimelineFilter
  /** The pane's project, offered as a narrower scope. */
  project(): { id: string; name: string } | null
  projectName(id: string): string
}

/** Searching every session log from the timeline panel: filters, a debounced request, and the grouped results. */
export class AllSessionsSearch {
  readonly el: HTMLElement
  private readonly projectFilter = new FilterMenu({ name: 'Project', onChange: () => this.schedule(0) })
  private readonly agentFilter = new FilterMenu({ name: 'Agent', onChange: () => this.schedule(0) })
  private readonly status = h('p', { class: 'tl-empty', role: 'status' })
  private readonly results = h('div', { class: 'tl-results' })
  private timer: ReturnType<typeof setTimeout> | null = null
  private token = 0
  private groups: SessionHits<ResumeSession>[] = []
  private projectKey = ''

  constructor(private readonly deps: AllSearchDeps) {
    this.agentFilter.setOptions([{ value: '', label: 'Any agent' }, ...AGENTS.map((agent) => ({ value: agent, label: AGENT_NAMES[agent], agent }))])
    this.projectFilter.setOptions([{ value: '', label: 'All projects' }])
    this.el = h('div', { class: 'tl-all', hidden: true }, h('div', { class: 'tl-all-filters' }, this.projectFilter.el, this.agentFilter.el), this.status, this.results)
  }

  /** Refreshes the project choices; call when the panel switches to this scope. */
  syncProjects(): void {
    const project = this.deps.project()
    const key = project ? `${project.id}:${project.name}` : ''
    if (key === this.projectKey) return
    this.projectKey = key
    const previous = this.projectFilter.value
    this.projectFilter.setOptions([
      { value: '', label: 'All projects' },
      ...(project ? [{ value: project.id, label: `This project (${project.name})`, chip: 'This project' }] : [])
    ])
    this.projectFilter.setValue(project && previous === project.id ? previous : '')
  }

  /** Runs the search after a short pause, or at once with 0. A newer search replaces an older one. */
  schedule(delay = DEBOUNCE_MS): void {
    if (this.timer) clearTimeout(this.timer)
    const token = ++this.token
    if (this.deps.query().trim() === '') {
      void api.searchTimelines({ id: `${this.deps.paneId}-${token}`, query: '', filter: 'all' }).catch(() => undefined)
      this.groups = []
      this.show('')
      return
    }
    this.show('Searching…')
    this.timer = setTimeout(() => void this.run(token), delay)
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.token += 1
  }

  /** The sessions with matches, for the counter. */
  count(): number {
    return this.groups.length
  }

  private async run(token: number): Promise<void> {
    const agent = this.agentFilter.value as AgentKind | ''
    const result = await api
      .searchTimelines({
        id: `${this.deps.paneId}-${token}`,
        query: this.deps.query(),
        projectId: this.projectFilter.value || undefined,
        agent: agent || undefined,
        filter: this.deps.filter()
      })
      .catch(() => null)
    if (token !== this.token || result?.status === 'cancelled') return
    if (!result) return this.show('The search failed.')
    this.groups = result.groups
    const note = result.more ? ' Showing the newest sessions with matches; narrow the search to see others.' : ''
    this.show(result.groups.length === 0 ? `No session has "${this.deps.query().trim()}".` : `${result.groups.length} session${result.groups.length === 1 ? '' : 's'} with matches.${note}`)
  }

  private show(message: string): void {
    this.status.textContent = message === '' ? 'Type to search the prompts, replies, files, commands and test results of every session.' : message
    this.results.replaceChildren(...resultGroups(this.groups, this.deps.projectName, this.deps))
  }
}
