import { addProject, removeProject, showProjectsTab, updateProject } from '../actions'
import { api } from '../api'
import { AGENTS, AGENT_NAMES, agentOf } from '../../shared/agents'
import type { AgentKind, Project } from '../../shared/types'
import { clear, h } from '../dom'
import type { AppState, ProjectsTab } from '../state'
import { InstructionsPanelComponent } from './instructionsPanel'
import { SnippetsPanelComponent } from './snippetsPanel'
import { TasksPanelComponent } from './tasksPanel'

export class ProjectsViewComponent {
  readonly el = h('main', { class: 'projects-view', 'aria-label': 'Projects' })
  private readonly rows = h('div', { class: 'proj-table' })
  private readonly errors = new Map<string, string>()
  private readonly drafts = new Map<string, { name?: string; folder?: string }>()
  private readonly counts = new Map<string, HTMLElement>()
  private signature = ''
  private current: AppState | null = null

  private readonly snippets = new SnippetsPanelComponent()
  private readonly tasks = new TasksPanelComponent()
  private readonly instructions = new InstructionsPanelComponent()
  private readonly tabs = new Map<ProjectsTab, HTMLElement>()
  private readonly projectsPanel = h('div', { class: 'proj-panel', role: 'tabpanel', id: 'panel-projects' })

  constructor() {
    this.projectsPanel.append(
      h('p', { class: 'lede' }, "Each project maps to a folder. Starting a session opens the project's default agent there."),
      h(
        'div',
        { class: 'proj-table-head' },
        h('span', {}, 'Name'),
        h('span', {}, 'Folder'),
        h('span', {}, 'Agent'),
        h('span', {}, 'Sessions'),
        h('span', {})
      ),
      this.rows,
      h(
        'div',
        { class: 'proj-actions' },
        h('button', { class: 'btn ghost', type: 'button', id: 'add-project', onClick: () => void this.add() }, 'Add project')
      )
    )
    this.snippets.el.setAttribute('role', 'tabpanel')
    this.snippets.el.id = 'panel-snippets'
    this.instructions.el.setAttribute('role', 'tabpanel')
    this.instructions.el.id = 'panel-instructions'
    this.tasks.el.setAttribute('role', 'tabpanel')
    this.tasks.el.id = 'panel-tasks'
    this.el.append(h('h1', {}, 'Projects'), this.tabBar(), this.projectsPanel, this.tasks.el, this.snippets.el, this.instructions.el)
  }

  private tabBar(): HTMLElement {
    const tab = (value: ProjectsTab, label: string): HTMLElement => {
      const button = h(
        'button',
        {
          class: 'rp-tab',
          type: 'button',
          role: 'tab',
          id: `tab-${value}`,
          'aria-controls': `panel-${value}`,
          onClick: () => showProjectsTab(value)
        },
        label
      )
      this.tabs.set(value, button)
      return button
    }
    return h('div', { class: 'rp-tabs proj-tabs', role: 'tablist', 'aria-label': 'Projects view' }, tab('projects', 'Projects'),
      tab('tasks', 'Tasks'),
      tab('snippets', 'Snippets'),
      tab('instructions', 'Instructions')
    )
  }

  private updateTabs(state: AppState): void {
    for (const [value, button] of this.tabs) {
      const selected = state.projectsTab === value
      button.classList.toggle('selected', selected)
      button.setAttribute('aria-selected', String(selected))
      button.tabIndex = selected ? 0 : -1
    }
    this.projectsPanel.hidden = state.projectsTab !== 'projects'
    this.tasks.el.hidden = state.projectsTab !== 'tasks'
    this.snippets.el.hidden = state.projectsTab !== 'snippets'
    this.instructions.el.hidden = state.projectsTab !== 'instructions'
  }

  update(state: AppState): void {
    this.current = state
    this.updateTabs(state)
    this.snippets.update(state)
    this.tasks.update(state)
    this.instructions.update(state)
    this.updateCounts(state)
    const signature = JSON.stringify(state.settings.projects.map((p) => [p.id, p.name, p.folder, p.defaultAgent]))
    if (signature === this.signature) return
    this.signature = signature
    this.rebuild(state)
    void this.validateAll(state.settings.projects)
  }

  show(state: AppState): void {
    this.signature = ''
    this.update(state)
  }

  private updateCounts(state: AppState): void {
    for (const [id, element] of this.counts) {
      const total = state.panes.filter((p) => p.projectId === id).length
      element.textContent = total === 0 ? 'none' : `${total} session${total === 1 ? '' : 's'}`
      element.classList.toggle('muted', total === 0)
    }
  }

  private rebuild(state: AppState): void {
    clear(this.rows)
    this.counts.clear()
    if (state.settings.projects.length === 0) {
      this.rows.append(h('p', { class: 'proj-empty' }, 'No projects yet. Add one to start a session.'))
      return
    }
    for (const project of state.settings.projects) this.rows.append(this.row(project))
    this.updateCounts(state)
  }

  private row(project: Project): HTMLElement {
    const draft = this.drafts.get(project.id) ?? {}
    const name = h('input', { class: 'text-input', type: 'text', id: `name-${project.id}`, value: draft.name ?? project.name })
    const folder = h('input', { class: 'text-input mono', type: 'text', id: `folder-${project.id}`, value: draft.folder ?? project.folder })
    const error = h('p', { class: 'field-error', id: `error-${project.id}`, role: 'alert', hidden: !this.errors.has(project.id) }, this.errors.get(project.id) ?? '')
    const count = h('span', { class: 'proj-sessions' })
    this.counts.set(project.id, count)

    const setError = (message: string | null): void => {
      if (message) this.errors.set(project.id, message)
      else this.errors.delete(project.id)
      error.textContent = message ?? ''
      error.hidden = message === null
      folder.classList.toggle('invalid', message !== null)
    }
    name.addEventListener('change', () => this.commitName(project, name, setError))
    folder.addEventListener('change', () => void this.commitFolder(project, folder, setError))
    folder.addEventListener('input', () => this.drafts.set(project.id, { ...this.drafts.get(project.id), folder: folder.value }))
    const browse = h('button', { class: 'btn ghost', type: 'button', 'aria-label': `Browse folder for ${project.name}`, onClick: async () => {
      const picked = await api.pickFolder()
      if (!picked) return
      folder.value = picked
      await this.commitFolder(project, folder, setError)
    } }, 'Browse')
    const remove = h('button', { class: 'btn ghost', type: 'button', 'aria-label': `Remove ${project.name}`, onClick: () => void removeProject(project.id) }, 'Remove')
    folder.classList.toggle('invalid', this.errors.has(project.id))
    return h(
      'div',
      { class: 'proj-line', 'data-project-id': project.id },
      h('div', { class: 'cell' }, h('label', { for: name.id, class: 'sr-only' }, `Name of ${project.name}`), name),
      h('div', { class: 'cell folder-cell' }, h('label', { for: folder.id, class: 'sr-only' }, `Folder of ${project.name}`), folder, browse),
      this.agentControl(project),
      count,
      remove,
      error
    )
  }

  private agentControl(project: Project): HTMLElement {
    const current = agentOf(project)
    const option = (agent: AgentKind): HTMLElement =>
      h(
        'button',
        {
          class: `seg-btn${agent === current ? ' on' : ''}`,
          type: 'button',
          role: 'radio',
          'aria-checked': String(agent === current),
          'data-agent': agent,
          onClick: () => {
            if (agent !== current) updateProject(project.id, { defaultAgent: agent })
          }
        },
        AGENT_NAMES[agent]
      )
    return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': `Default agent for ${project.name}` }, ...AGENTS.map(option))
  }

  private commitName(project: Project, input: HTMLInputElement, setError: (m: string | null) => void): void {
    const value = input.value.trim()
    if (!value) {
      input.value = project.name
      setError('Name cannot be empty.')
      return
    }
    if (value !== project.name) updateProject(project.id, { name: value })
  }

  private async commitFolder(project: Project, input: HTMLInputElement, setError: (m: string | null) => void): Promise<void> {
    const value = input.value.trim()
    const check = await api.checkFolder(value)
    if (!check.ok) {
      setError(check.error ?? 'This folder is not usable.')
      return
    }
    setError(null)
    this.drafts.delete(project.id)
    if (value !== project.folder) updateProject(project.id, { folder: value })
  }

  private async validateAll(projects: Project[]): Promise<void> {
    for (const project of projects) {
      const check = await api.checkFolder(project.folder)
      const row = this.rows.querySelector(`[data-project-id="${project.id}"]`)
      const error = row?.querySelector<HTMLElement>('.field-error')
      if (!row || !error) continue
      if (check.ok) this.errors.delete(project.id)
      else this.errors.set(project.id, check.error ?? 'This folder is not usable.')
      error.textContent = this.errors.get(project.id) ?? ''
      error.hidden = !this.errors.has(project.id)
      row.querySelector('.folder-cell input')?.classList.toggle('invalid', this.errors.has(project.id))
    }
  }

  private async add(): Promise<void> {
    const project = await addProject()
    if (!project) return
    requestAnimationFrame(() => document.getElementById(`name-${project.id}`)?.focus())
  }
}
