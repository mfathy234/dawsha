import { addProject, removeProject, showProjectsTab, startSession, updateProject } from '../actions'
import { api } from '../api'
import { AGENTS, AGENT_NAMES, agentOf } from '../../shared/agents'
import { countSessionStates, sessionState, type SessionState } from '../../shared/sessionState'
import type { AgentKind, Project } from '../../shared/types'
import { derivePanes } from '../derive'
import { clear, h, icon, iconButton, placeNearAnchor, leave } from '../dom'
import { ICONS } from '../icons'
import type { AppState, ProjectsTab } from '../state'
import { agentMark } from './agentMark'
import { InstructionsPanelComponent } from './instructionsPanel'
import { stateIcon } from './stateIcon'
import { TasksPanelComponent } from './tasksPanel'

const MAC = navigator.platform.toLowerCase().includes('mac')
const FILE_MANAGER = MAC ? 'Finder' : 'Explorer'

export class ProjectsViewComponent {
  readonly el = h('main', { class: 'projects-view', 'aria-label': 'Projects' })
  private readonly rows = h('div', { class: 'pv-list' })
  private readonly errors = new Map<string, string>()
  private readonly metas = new Map<string, HTMLElement>()
  private readonly filterInput = h('input', {
    class: 'text-input pv-filter',
    type: 'search',
    id: 'projects-view-filter',
    placeholder: 'Filter projects',
    'aria-label': 'Filter projects',
    autocomplete: 'off'
  })
  private filter = ''
  private renaming: string | null = null
  private menu: HTMLElement | null = null
  private menuAnchor: HTMLElement | null = null
  private signature = ''
  private current: AppState | null = null

  private readonly tasks = new TasksPanelComponent()
  private readonly instructions = new InstructionsPanelComponent()
  private readonly tabs = new Map<ProjectsTab, HTMLElement>()
  private readonly projectsPanel = h('div', { class: 'proj-panel', role: 'tabpanel', id: 'panel-projects' })

  constructor() {
    this.filterInput.addEventListener('input', () => {
      this.filter = this.filterInput.value
      this.signature = ''
      if (this.current) this.update(this.current)
    })
    this.projectsPanel.append(
      h('p', { class: 'lede' }, "Each project maps to a folder. Starting a session opens the project's default agent there."),
      h(
        'div',
        { class: 'pv-toolbar' },
        this.filterInput,
        h('button', { class: 'btn ghost', type: 'button', id: 'add-project', onClick: () => void this.add() }, 'Add project')
      ),
      this.rows
    )
    this.instructions.el.setAttribute('role', 'tabpanel')
    this.instructions.el.id = 'panel-instructions'
    this.tasks.el.setAttribute('role', 'tabpanel')
    this.tasks.el.id = 'panel-tasks'
    this.el.append(h('h1', {}, 'Projects'), this.tabBar(), this.projectsPanel, this.tasks.el, this.instructions.el)
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
    this.instructions.el.hidden = state.projectsTab !== 'instructions'
  }

  update(state: AppState): void {
    this.current = state
    this.updateTabs(state)
    this.tasks.update(state)
    this.instructions.update(state)
    if (state.view !== 'projects') this.closeMenu()
    this.updateMeta(state)
    const signature = JSON.stringify([state.settings.projects.map((p) => [p.id, p.name, p.folder, p.defaultAgent]), this.filter, this.renaming])
    if (signature === this.signature) return
    this.signature = signature
    this.rebuild(state)
    void this.validateAll(state.settings.projects)
  }

  show(state: AppState): void {
    this.signature = ''
    this.update(state)
  }

  private matches(project: Project): boolean {
    const needle = this.filter.trim().toLowerCase()
    return needle === '' || project.name.toLowerCase().includes(needle)
  }

  private updateMeta(state: AppState): void {
    if (this.metas.size === 0) return
    const views = derivePanes(state)
    for (const project of state.settings.projects) {
      const meta = this.metas.get(project.id)
      if (!meta) continue
      const states: SessionState[] = views.filter((view) => view.pane.projectId === project.id).map((view) => sessionState(view))
      const agent = agentOf(project)
      const branch = state.branches[project.folder]
      const children: Node[] = [h('span', { class: 'pv-agent', title: 'Default agent' }, agentMark(agent), AGENT_NAMES[agent])]
      if (branch) children.push(h('span', { class: 'pv-branch', title: `Branch ${branch}` }, icon(ICONS.branch), branch))
      children.push(this.sessionsLine(states))
      meta.replaceChildren(...children)
    }
  }

  private sessionsLine(states: SessionState[]): HTMLElement {
    const counts = countSessionStates(states)
    if (counts.total === 0) return h('span', { class: 'pv-sessions muted' }, 'No sessions')
    const part = (state: SessionState, count: number, label: string): HTMLElement | null =>
      count > 0 ? h('span', { class: `pv-state state-${state}`, title: `${count} ${label}` }, stateIcon(state), String(count)) : null
    return h(
      'span',
      { class: 'pv-sessions' },
      `${counts.total} session${counts.total === 1 ? '' : 's'}`,
      part('needs', counts.needs, 'need you'),
      part('working', counts.working, 'working'),
      part('done', counts.done, 'done')
    )
  }

  private rebuild(state: AppState): void {
    clear(this.rows)
    this.metas.clear()
    const all = state.settings.projects
    if (all.length === 0) {
      this.rows.append(h('p', { class: 'proj-empty' }, 'No projects yet. Add one to start a session.'))
      return
    }
    const shown = all.filter((project) => this.matches(project))
    if (shown.length === 0) {
      this.rows.append(h('p', { class: 'proj-empty' }, `No project matches "${this.filter.trim()}".`))
      return
    }
    for (const project of shown) this.rows.append(this.row(project))
    this.updateMeta(state)
    if (this.renaming) {
      const input = this.rows.querySelector<HTMLInputElement>('.pv-rename')
      requestAnimationFrame(() => {
        input?.focus()
        input?.select()
      })
    }
  }

  private row(project: Project): HTMLElement {
    const error = h('p', { class: 'field-error', id: `error-${project.id}`, role: 'alert', hidden: !this.errors.has(project.id) }, this.errors.get(project.id) ?? '')
    const meta = h('div', { class: 'pv-meta' })
    this.metas.set(project.id, meta)
    const more = iconButton(`More for ${project.name}`, ICONS.more, () => this.toggleMenu(project, more), 'pv-more')
    more.setAttribute('aria-haspopup', 'menu')
    return h(
      'div',
      { class: 'pv-row', 'data-project-id': project.id },
      h(
        'div',
        { class: 'pv-main' },
        this.renaming === project.id ? this.renameInput(project) : h('div', { class: 'pv-name' }, project.name),
        h('div', { class: `pv-folder${this.errors.has(project.id) ? ' invalid' : ''}`, title: project.folder }, project.folder)
      ),
      meta,
      h(
        'div',
        { class: 'pv-actions' },
        h(
          'button',
          { class: 'btn small', type: 'button', 'aria-label': `New session in ${project.name}`, onClick: () => void startSession(project.id) },
          'New session'
        ),
        more
      ),
      error
    )
  }

  private renameInput(project: Project): HTMLInputElement {
    const input = h('input', {
      class: 'text-input pv-rename',
      type: 'text',
      id: `name-${project.id}`,
      value: project.name,
      'aria-label': `Name of ${project.name}`
    })
    let done = false
    const finish = (save: boolean): void => {
      if (done) return
      const value = input.value.trim()
      if (save && !value) {
        this.showRowError(project.id, 'Name cannot be empty.', 'name')
        return
      }
      done = true
      this.renaming = null
      if (save && value !== project.name) updateProject(project.id, { name: value })
      this.signature = ''
      if (this.current) this.update(this.current)
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        finish(true)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(false))
    return input
  }

  /** Folder errors are kept across renders; a name error belongs to the open rename box only. */
  private showRowError(projectId: string, message: string | null, field: 'folder' | 'name' = 'folder'): void {
    if (field === 'folder') {
      if (message) this.errors.set(projectId, message)
      else this.errors.delete(projectId)
    }
    const row = this.rows.querySelector(`[data-project-id="${projectId}"]`)
    const error = row?.querySelector<HTMLElement>('.field-error')
    if (!row || !error) return
    error.textContent = message ?? ''
    error.hidden = message === null
    row.querySelector(field === 'folder' ? '.pv-folder' : '.pv-rename')?.classList.toggle('invalid', message !== null)
  }

  private toggleMenu(project: Project, anchor: HTMLElement): void {
    if (this.menu && this.menuAnchor === anchor) return this.closeMenu(true)
    this.closeMenu()
    const current = agentOf(project)
    const item = (label: string, run: () => void, extra: { danger?: boolean; agent?: AgentKind } = {}): HTMLButtonElement =>
      h(
        'button',
        {
          class: `menu-item pv-menu-item${extra.danger ? ' danger-item' : ''}`,
          type: 'button',
          role: extra.agent ? 'menuitemradio' : 'menuitem',
          'aria-checked': extra.agent ? String(extra.agent === current) : undefined,
          'data-agent': extra.agent,
          onClick: () => {
            this.closeMenu()
            run()
          }
        },
        extra.agent ? agentMark(extra.agent) : null,
        h('span', { class: 'menu-label' }, label),
        extra.agent === current ? icon(ICONS.check) : null
      )
    const agentItem = (agent: AgentKind): HTMLButtonElement =>
      item(AGENT_NAMES[agent], () => agent !== current && updateProject(project.id, { defaultAgent: agent }), { agent })
    const menu = h(
      'div',
      { class: 'popover menu pv-menu', role: 'menu', 'aria-label': `More for ${project.name}` },
      item('Rename', () => this.startRename(project.id)),
      item('Change folder…', () => void this.changeFolder(project)),
      h('div', { class: 'pv-menu-label', role: 'presentation' }, 'Default agent'),
      ...AGENTS.map(agentItem),
      h('div', { class: 'pv-menu-sep', role: 'separator' }),
      item(`Open in ${FILE_MANAGER}`, () => void api.quickOpen('explorer', project.folder)),
      item('Open a terminal here', () => void startSession(project.id, 'shell')),
      h('div', { class: 'pv-menu-sep', role: 'separator' }),
      item(`Remove ${project.name}…`, () => void removeProject(project.id), { danger: true })
    )
    menu.addEventListener('keydown', (event) => this.menuKey(event))
    document.body.append(menu)
    placeNearAnchor(menu, anchor)
    this.menu = menu
    this.menuAnchor = anchor
    anchor.setAttribute('aria-expanded', 'true')
    menu.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0)
  }

  private menuKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closeMenu(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(this.menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.menu && !this.menu.contains(target) && !this.menuAnchor?.contains(target)) this.closeMenu()
  }

  private closeMenu(restoreFocus = false): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.menuAnchor?.removeAttribute('aria-expanded')
    leave(this.menu)
    if (restoreFocus && this.menuAnchor?.isConnected) this.menuAnchor.focus()
    this.menu = null
    this.menuAnchor = null
  }

  private startRename(projectId: string): void {
    this.renaming = projectId
    this.signature = ''
    if (this.current) this.update(this.current)
  }

  private async changeFolder(project: Project): Promise<void> {
    const picked = await api.pickFolder()
    if (!picked) return
    const check = await api.checkFolder(picked)
    if (!check.ok) {
      this.showRowError(project.id, check.error ?? 'This folder is not usable.')
      return
    }
    this.showRowError(project.id, null)
    if (picked !== project.folder) updateProject(project.id, { folder: picked })
  }

  private async validateAll(projects: Project[]): Promise<void> {
    for (const project of projects) {
      const check = await api.checkFolder(project.folder)
      if (!this.rows.querySelector(`[data-project-id="${project.id}"]`)) continue
      this.showRowError(project.id, check.ok ? null : (check.error ?? 'This folder is not usable.'))
    }
  }

  private async add(): Promise<void> {
    const project = await addProject()
    if (!project) return
    this.filter = ''
    this.filterInput.value = ''
    this.renaming = project.id
    this.signature = ''
    if (this.current) this.update(this.current)
  }
}
