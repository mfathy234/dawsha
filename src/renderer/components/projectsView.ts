import { addProject, removeProject, showProjectsTab, startSession, updateProject } from '../actions'
import { api } from '../api'
import { AGENTS, AGENT_NAMES, agentOf } from '../../shared/agents'
import { countSessionStates, sessionState, type SessionState } from '../../shared/sessionState'
import { closedSessionsFor } from '../../shared/keptSessions'
import { dataAge } from '../../shared/agentLimits'
import { projectBranches } from '../../shared/projectTree'
import { truncateMiddle } from '../../shared/pathText'
import type { ProjectGroup } from '../../shared/worktreeGroups'
import type { AgentKind, Project } from '../../shared/types'
import { derivePanes } from '../derive'
import { clear, h, icon, iconButton, placeNearAnchor, leave } from '../dom'
import { ICONS } from '../icons'
import type { AppState, ProjectsTab } from '../state'
import { agentMark } from './agentMark'
import { InstructionsPanelComponent } from './instructionsPanel'
import { stateIcon } from './stateIcon'
import { TasksPanelComponent } from './tasksPanel'
import { pageHeader } from './pageHeader'
import './projectsView.css'

const MAC = navigator.platform.toLowerCase().includes('mac')
const FILE_MANAGER = MAC ? 'Finder' : 'Explorer'
const PATH_CHARS = 46

interface RowCells {
  branch: HTMLElement
  sessions: HTMLElement
  last: HTMLElement
}

export class ProjectsViewComponent {
  readonly el = h('main', { class: 'projects-view', 'aria-label': 'Projects' })
  private readonly rows = h('div', { class: 'pv-list' })
  private readonly errors = new Map<string, string>()
  private readonly metas = new Map<string, RowCells>()
  private readonly filterInput = h('input', {
    class: 'text-input pv-filter',
    type: 'search',
    id: 'projects-view-filter',
    placeholder: 'Search projects',
    'aria-label': 'Filter projects',
    autocomplete: 'off'
  })
  private filter = ''
  private renaming: string | null = null
  private menu: HTMLElement | null = null
  private menuAnchor: HTMLElement | null = null
  private signature = ''
  private current: AppState | null = null
  /** Which project each configured project counts under: a worktree of another project is listed beneath it. */
  private groups: Record<string, ProjectGroup> = {}
  private groupsKey = ''

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
    this.projectsPanel.append(this.rows)
    this.instructions.el.setAttribute('role', 'tabpanel')
    this.instructions.el.id = 'panel-instructions'
    this.tasks.el.setAttribute('role', 'tabpanel')
    this.tasks.el.id = 'panel-tasks'
    const add = h('button', { class: 'btn ghost', type: 'button', id: 'add-project', onClick: () => void this.add() }, 'Add project')
    this.el.append(
      pageHeader({ title: 'Projects', subtitle: 'Folders your sessions run in. Add, locate or remove them here.', actions: [this.filterInput, add] }),
      h('div', { class: 'projects-body' }, this.tabBar(), this.projectsPanel, this.tasks.el, this.instructions.el)
    )
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
    this.refreshGroups(state.settings.projects)
    this.updateMeta(state)
    const signature = JSON.stringify([state.settings.projects.map((p) => [p.id, p.name, p.folder, p.defaultAgent]), this.filter, this.renaming, this.groups])
    if (signature === this.signature) return
    this.signature = signature
    this.rebuild(state)
    void this.validateAll(state.settings.projects)
  }

  show(state: AppState): void {
    this.signature = ''
    this.update(state)
  }

  /** Worktree groups come from the main process (git), once per change to the project folders. */
  private refreshGroups(projects: Project[]): void {
    const key = JSON.stringify(projects.map((p) => [p.id, p.folder]))
    if (key === this.groupsKey) return
    this.groupsKey = key
    void api.projectGroups().then((groups) => {
      if (key !== this.groupsKey) return
      this.groups = groups
      this.signature = ''
      if (this.current) this.update(this.current)
    }).catch((error: unknown) => console.warn('Could not read the worktrees of the projects', error))
  }

  private matches(project: Project): boolean {
    const needle = this.filter.trim().toLowerCase()
    return needle === '' || project.name.toLowerCase().includes(needle)
  }

  private updateMeta(state: AppState): void {
    if (this.metas.size === 0) return
    const views = derivePanes(state)
    const now = state.now
    for (const project of state.settings.projects) {
      const cells = this.metas.get(project.id)
      if (!cells) continue
      const live = views.filter((view) => view.pane.projectId === project.id)
      const closed = closedSessionsFor(state.settings.keptSessions, project.id, new Set())
      const branch = state.branches[project.folder] ?? null
      const lastClosed = closed[0]?.closedAt ?? null
      cells.branch.replaceChildren(this.branchCell(branch))
      cells.sessions.replaceChildren(this.sessionsCell(live.map((view) => sessionState(view)), closed.length))
      cells.last.replaceChildren(this.lastCell(live.length > 0, lastClosed, now))
    }
  }

  private branchCell(branch: string | null): HTMLElement {
    if (!branch) return h('span', { class: 'pv-cell pv-branch-cell muted' }, 'No branch')
    return h('span', { class: 'pv-cell pv-branch-cell', title: `Branch ${branch}` }, icon(ICONS.branch), h('span', { class: 'pv-branch-name' }, branch))
  }

  private sessionsCell(states: SessionState[], closed: number): HTMLElement {
    const counts = countSessionStates(states)
    const part = (state: SessionState, count: number, label: string): HTMLElement | null =>
      count > 0 ? h('span', { class: `pv-state state-${state}`, title: `${count} ${label}` }, stateIcon(state), String(count)) : null
    return h('span', { class: 'pv-cell pv-sessions-cell' },
      h('span', { class: 'pv-live', title: `${counts.total} open` }, `${counts.total} live`),
      part('needs', counts.needs, 'need you'),
      part('working', counts.working, 'working'),
      h('span', { class: 'pv-closed muted' }, `${closed} closed`)
    )
  }

  private lastCell(live: boolean, closedAt: number | null, now: number): HTMLElement {
    if (live) return h('span', { class: 'pv-cell pv-last-cell' }, 'Now')
    if (closedAt === null) return h('span', { class: 'pv-cell pv-last-cell muted' }, 'Never')
    return h('span', { class: 'pv-cell pv-last-cell', title: new Date(closedAt).toLocaleString() }, dataAge(closedAt, now))
  }

  private rebuild(state: AppState): void {
    clear(this.rows)
    this.metas.clear()
    const all = state.settings.projects
    if (all.length === 0) {
      this.rows.append(h('p', { class: 'proj-empty' }, 'No projects yet. Add one to start a session.'))
      return
    }
    const shown = projectBranches(all, this.groups).flatMap((branch) => {
      const rootHit = this.matches(branch.project)
      const worktrees = branch.worktrees.filter((worktree) => rootHit || this.matches(worktree))
      return rootHit || worktrees.length > 0 ? [{ project: branch.project, worktrees }] : []
    })
    if (shown.length === 0) {
      this.rows.append(h('p', { class: 'proj-empty' }, `No project matches "${this.filter.trim()}".`))
      return
    }
    this.rows.append(this.head())
    for (const branch of shown) {
      this.rows.append(this.row(branch.project, false))
      for (const worktree of branch.worktrees) this.rows.append(this.row(worktree, true))
    }
    this.updateMeta(state)
    if (this.renaming) {
      const input = this.rows.querySelector<HTMLInputElement>('.pv-rename')
      requestAnimationFrame(() => {
        input?.focus()
        input?.select()
      })
    }
  }

  private head(): HTMLElement {
    return h('div', { class: 'pv-head', 'aria-hidden': 'true' },
      h('span', {}, 'Project'), h('span', {}, 'Branch'), h('span', {}, 'Sessions'), h('span', {}, 'Last active'), h('span', {}))
  }

  private row(project: Project, worktree: boolean): HTMLElement {
    const missing = this.errors.has(project.id)
    const error = h('p', { class: 'field-error', id: `error-${project.id}`, role: 'alert', hidden: !missing }, this.errors.get(project.id) ?? '')
    const cells: RowCells = {
      branch: h('span', { class: 'pv-cell pv-branch-cell' }),
      sessions: h('span', { class: 'pv-cell pv-sessions-cell' }),
      last: h('span', { class: 'pv-cell pv-last-cell' })
    }
    this.metas.set(project.id, cells)
    const more = iconButton(`More for ${project.name}`, ICONS.more, () => this.toggleMenu(project, more), 'pv-more')
    more.setAttribute('aria-haspopup', 'menu')
    const open = iconButton(`Open the folder of ${project.name}`, ICONS.folder, () => void api.quickOpen('explorer', project.folder), 'pv-open')
    open.hidden = missing
    return h(
      'div',
      { class: `pv-row${worktree ? ' pv-worktree' : ''}${missing ? ' missing' : ''}`, 'data-project-id': project.id },
      h(
        'div',
        { class: 'pv-main' },
        this.renaming === project.id ? this.renameInput(project) : h('div', { class: 'pv-name' }, worktree ? h('span', { class: 'pv-worktree-mark' }, 'Worktree') : null, project.name),
        h('div', { class: `pv-folder${missing ? ' invalid' : ''}`, title: project.folder }, truncateMiddle(project.folder, PATH_CHARS)),
        h('span', { class: 'pv-missing', hidden: !missing }, 'Folder not found')
      ),
      cells.branch,
      cells.sessions,
      cells.last,
      h(
        'div',
        { class: 'pv-actions' },
        h('button', { class: 'btn small', type: 'button', 'aria-label': `New session in ${project.name}`, onClick: () => void startSession(project.id) }, 'New session'),
        h('button', { class: 'btn small pv-locate', type: 'button', hidden: !missing, 'aria-label': `Locate the folder for ${project.name}`, onClick: () => void this.changeFolder(project) }, 'Locate…'),
        open,
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
    if (field === 'folder') {
      row.classList.toggle('missing', message !== null)
      const missing = row.querySelector<HTMLElement>('.pv-missing')
      if (missing) missing.hidden = message === null
      const locate = row.querySelector<HTMLButtonElement>('.pv-locate')
      if (locate) locate.hidden = message === null
      const open = row.querySelector<HTMLButtonElement>('.pv-open')
      if (open) open.hidden = message !== null
    }
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
