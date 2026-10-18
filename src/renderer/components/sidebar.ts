import { AGENT_NAMES, agentOf } from '../../shared/agents'
import { filterProjects } from '../../shared/quickPick'
import { projectTodayLabel, projectTodayShort, projectTodayTooltip } from '../../shared/sessionCost'
import type { AgentKind, Project } from '../../shared/types'
import { closePane, focusPane, openResumePicker, removeKeptSession, showView, startSession, toggleProjectExpanded, toggleSidebar } from '../actions'
import type { PaneView } from '../derive'
import { clear, h, icon, iconButton } from '../dom'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { stateIcon } from './stateIcon'
import { SESSION_STATE_LABELS, sessionState } from '../../shared/sessionState'
import { needsCount } from '../../shared/attentionBadge'
import { syncAttentionBadge } from '../attentionBadge'
import type { AppState } from '../state'

export function isSidebarCollapsed(state: AppState): boolean {
  const maximized = state.view === 'grid' && state.maximizedId !== null
  return state.sidebarOverride ?? (maximized || state.settings.sidebarCollapsed)
}

const viewState = (view: PaneView) => sessionState({ status: view.status, attention: view.attention })

export class SidebarComponent {
  readonly el = h('aside', { class: 'sidebar', 'aria-label': 'Projects' })
  private readonly filter = h('input', {
    id: 'sidebar-project-filter',
    class: 'text-input',
    type: 'text',
    placeholder: 'Filter projects',
    autocomplete: 'off'
  })
  private readonly list = h('div', { class: 'proj-list' })
  private signature = ''
  private filterText = ''

  constructor() {
    this.filter.addEventListener('input', () => {
      this.filterText = this.filter.value
      this.signature = ''
      this.render(this.lastState, this.lastViews)
    })
  }

  private lastState: AppState | null = null
  private lastViews: PaneView[] = []

  update(state: AppState, views: PaneView[]): void {
    this.lastState = state
    this.lastViews = views
    this.render(state, views)
  }

  private render(state: AppState | null, views: PaneView[]): void {
    if (!state) return
    syncAttentionBadge(needsCount(views.map(viewState)))
    const collapsed = isSidebarCollapsed(state)
    const focusedView = views.find((v) => v.pane.id === state.focusedId)
    const projects = filterProjects(state.settings.projects, this.filterText)
    const signature = JSON.stringify([
      collapsed,
      state.view,
      focusedView?.pane.projectId,
      state.focusedId,
      projects.map((p) => [p.id, p.name, p.defaultAgent]),
      state.collapsedProjects,
      projects.map((p) => projectTodayLabel(state.usage.projectsToday[p.id])),
      views.map((v) => [v.pane.id, v.pane.projectId, v.title, v.status, v.agent, v.attention]),
      state.settings.keptSessions
    ])
    if (signature === this.signature) return
    this.signature = signature
    this.el.classList.toggle('rail', collapsed)
    this.el.setAttribute('aria-label', collapsed ? 'Projects (collapsed)' : 'Projects')
    if (collapsed) this.renderRail(state, projects, focusedView?.pane.projectId)
    else this.renderFull(state, projects, views)
  }

  private renderRail(state: AppState, projects: AppState['settings']['projects'], activeProject?: string): void {
    clear(this.el)
    this.el.append(
      iconButton('Expand sidebar', ICONS.expand, () => toggleSidebar(), 'rail-btn'),
      h('div', { class: 'rail-divider' })
    )
    for (const project of projects) {
      const button = iconButton(project.name, ICONS.folderLarge, () => void startSession(project.id), 'rail-btn')
      button.classList.toggle('selected', project.id === activeProject)
      this.el.append(button)
    }
    void state
  }

  private renderFull(state: AppState, projects: AppState['settings']['projects'], views: PaneView[]): void {
    const hadFocus = document.activeElement === this.filter
    clear(this.el)
    clear(this.list)
    this.list.append(...this.needsGroup(state, views))
    for (const project of projects) this.list.append(...this.projectRows(state, project, views))
    if (projects.length === 0) {
      this.list.append(
        h('p', { class: 'proj-empty' }, state.settings.projects.length === 0 ? 'No projects yet.' : 'No project matches.')
      )
    }
    this.el.append(
      h(
        'div',
        { class: 'sidebar-head' },
        h('span', { class: 'sidebar-title' }, 'Projects'),
        iconButton('Collapse sidebar', ICONS.collapse, () => toggleSidebar())
      ),
      h(
        'div',
        { class: 'filter' },
        h('label', { for: 'sidebar-project-filter', class: 'sr-only' }, 'Filter projects'),
        icon(ICONS.search),
        this.filter
      ),
      this.list,
      h(
        'div',
        { class: 'sidebar-foot' },
        h(
          'button',
          {
            class: 'link',
            type: 'button',
            'aria-current': state.view === 'projects' ? 'page' : undefined,
            onClick: () => showView('projects')
          },
          'Manage projects'
        )
      )
    )
    if (hadFocus) this.filter.focus()
  }

  private projectRows(state: AppState, project: AppState['settings']['projects'][number], views: PaneView[]): HTMLElement[] {
    const own = views.filter((v) => v.pane.projectId === project.id)
    const collapsed = state.collapsedProjects[project.id] === true
    const sessionsToggle = iconButton(
      `${collapsed ? 'Show' : 'Hide'} sessions for ${project.name}`,
      collapsed ? ICONS.chevronRight : ICONS.chevronDown,
      () => toggleProjectExpanded(project.id),
      'small proj-collapse'
    )
    sessionsToggle.setAttribute('aria-expanded', String(!collapsed))
    const row = h(
      'div',
      { class: 'proj-row' },
      h('button', { class: 'proj-name', type: 'button', title: project.folder, onClick: () => void startSession(project.id) }, project.name),
      ...this.todayTotal(state, project.id),
      iconButton(
        `New ${AGENT_NAMES[agentOf(project)]} session in ${project.name}`,
        ICONS.plus,
        () => void startSession(project.id),
        'small'
      ),
      this.agentMenuButton(project),
      sessionsToggle
    )
    const rows: HTMLElement[] = [row]
    if (collapsed) {
      if (own.length > 0) rows.push(h('div', { class: 'proj-hidden' }, `${own.length} session${own.length === 1 ? '' : 's'} hidden`))
      return rows
    }
    for (const view of own) {
      const selected = view.pane.id === state.focusedId
      const sessionStateName = viewState(view)
      const stateLabel = SESSION_STATE_LABELS[sessionStateName]
      rows.push(
        h('div', { class: `kept-session-row${selected ? ' selected' : ''}` },
        h(
          'button',
          {
            class: `sess-row${selected ? ' selected' : ''}`,
            type: 'button',
            'aria-current': selected ? 'true' : undefined,
            onClick: () => focusPane(view.pane.id)
          },
          agentMark(view.agent),
          h('span', { class: 'sess-name', dir: 'auto' }, view.title),
          h('span', { class: `sess-state state-${sessionStateName}`, title: stateLabel }, stateIcon(sessionStateName), h('span', { class: 'sess-state-word' }, stateLabel))
        ),
        iconButton(`Close ${view.title} in ${project.name}`, ICONS.close, () => void closePane(view.pane.id), 'small sess-close')
        )
      )
    }
    const openKeys = new Set(state.panes.flatMap((pane) => pane.tabs.flatMap((tab) => tab.sessionId ? [`${tab.agent}:${tab.sessionId}`] : [])))
    const kept = state.settings.keptSessions.filter((session) => session.projectId === project.id && !openKeys.has(`${session.agent}:${session.sessionId}`))
    if (kept.length > 0) rows.push(h('div', { class: 'sess-group-label' }, `Closed sessions (${kept.length})`))
    for (const session of kept) {
      rows.push(h('div', { class: 'kept-session-row closed' },
        h('button', { class: 'sess-row', type: 'button', title: `Resume ${session.title}`, onClick: () => void startSession(project.id, session.agent, session.sessionId, true, session.title) },
          agentMark(session.agent), h('span', { class: 'sess-name', dir: 'auto' }, session.title)),
        iconButton(`Remove ${session.title} from ${project.name}`, ICONS.close, () => removeKeptSession(session.agent, session.sessionId), 'small sess-close')
      ))
    }
    return rows
  }

  private needsGroup(state: AppState, views: PaneView[]): HTMLElement[] {
    const waiting = views.filter((view) => viewState(view) === 'needs')
    if (waiting.length === 0) return []
    const rows = waiting.map((view) => {
      const project = state.settings.projects.find((p) => p.id === view.pane.projectId)
      return h(
        'button',
        {
          class: `sess-row needs-row${view.pane.id === state.focusedId ? ' selected' : ''}`,
          type: 'button',
          title: project ? `${view.title} in ${project.name}` : view.title,
          'aria-label': `${view.title}${project ? ` in ${project.name}` : ''}, needs you`,
          onClick: () => focusPane(view.pane.id)
        },
        agentMark(view.agent),
        h('span', { class: 'sess-name', dir: 'auto' }, view.title),
        project ? h('span', { class: 'needs-project' }, project.name) : null,
        h('span', { class: 'sess-state state-needs' }, stateIcon('needs'))
      )
    })
    return [h('section', { class: 'needs-group', 'aria-label': 'Needs you' }, h('div', { class: 'sess-group-label' }, `Needs you (${waiting.length})`), ...rows)]
  }

  private todayTotal(state: AppState, projectId: string): HTMLElement[] {
    const today = state.usage.projectsToday[projectId]
    const short = projectTodayShort(today)
    const label = projectTodayLabel(today)
    return short && label ? [h('span', { class: 'proj-today', title: projectTodayTooltip(today), 'aria-label': label }, short)] : []
  }

  private menu: HTMLElement | null = null

  private agentMenuButton(project: AppState['settings']['projects'][number]): HTMLElement {
    const button = iconButton(`Choose agent for ${project.name}`, ICONS.more, () => this.toggleMenu(button, project), 'small proj-agent-menu')
    button.setAttribute('aria-haspopup', 'menu')
    return button
  }

  private readonly outside = (event: Event): void => {
    if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu()
  }

  private closeMenu(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.menu?.remove()
    this.menu = null
  }

  private toggleMenu(anchor: HTMLElement, project: Project): void {
    if (this.menu) return this.closeMenu()
    const projectId = project.id
    const choose = (agent: AgentKind): void => {
      this.closeMenu()
      void startSession(projectId, agent)
    }
    const resume = h(
      'button',
      {
        class: 'menu-item',
        type: 'button',
        role: 'menuitem',
        onClick: () => {
          this.closeMenu()
          openResumePicker(projectId)
        }
      },
      `Resume in ${project.name}…`
    )
    const item = (agent: AgentKind): HTMLElement =>
      h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => choose(agent) }, agentMark(agent), `${AGENT_NAMES[agent]} session`)
    const rect = anchor.getBoundingClientRect()
    const first = item('claude')
    this.menu = h(
      'div',
      { class: 'popover menu floating', role: 'menu', style: `left:${Math.round(rect.left)}px;top:${Math.round(rect.bottom + 2)}px` },
      first,
      item('codex'),
      item('gemini'),
      resume
    )
    this.menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.closeMenu()
      anchor.focus()
    })
    document.body.appendChild(this.menu)
    first.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0)
  }
}
