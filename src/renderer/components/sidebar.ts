import { AGENT_NAMES, agentOf } from '../../shared/agents'
import { canMoveProject, orderProjects } from '../../shared/projectOrder'
import { projectStatus, projectStatusLabel } from '../../shared/projectStatus'
import { filterSidebar, type SidebarEntry } from '../../shared/sidebarFilter'
import { projectTodayLabel, projectTodayShort, projectTodayTooltip } from '../../shared/sessionCost'
import type { AgentKind, KeptSession, Project } from '../../shared/types'
import { clearClosedSessions, closePane, focusPane, moveProjectInList, openResumePicker, openSessionKeys, pinProject, removeKeptSession, showView, startSession, toggleClosedSessions, toggleClosedShowAll, toggleProjectExpanded, toggleSidebar } from '../actions'
import { CLOSED_PREVIEW_COUNT, closedAgoShort, closedDayLabel, groupClosedByDay } from '../../shared/keptSessions'
import type { PaneView } from '../derive'
import { clear, h, icon, iconButton, placeNearAnchor } from '../dom'
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

const NAV_SELECTOR = '.proj-name, .sess-row, .closed-toggle, .closed-more'

const viewState =(view: PaneView) => sessionState({ status: view.status, attention: view.attention })

export class SidebarComponent {
  readonly el = h('aside', { class: 'sidebar', 'aria-label': 'Projects' })
  private readonly filter = h('input', {
    id: 'sidebar-project-filter',
    class: 'text-input',
    type: 'text',
    placeholder: 'Filter projects and sessions',
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
    this.filter.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' || event.isComposing) return
      const first = this.navItems()[0]
      if (!first) return
      event.preventDefault()
      first.focus()
    })
    this.list.addEventListener('keydown', (event) => this.onListKey(event))
  }

  private restore: { key: string; index: number } | null = null

  private navItems(): HTMLElement[] {
    return Array.from(this.list.querySelectorAll<HTMLElement>(NAV_SELECTOR))
  }

  // Rows are rebuilt on every change, so focus is put back on the row with the same data-nav key.
  private focusedNav(): { key: string; index: number } | null {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !this.list.contains(active)) return null
    const key = active.dataset.nav
    return key ? { key, index: this.navItems().indexOf(active) } : null
  }

  private restoreFocus(target: { key: string; index: number } | null): void {
    if (!target) return
    const items = this.navItems()
    const found = items.find((item) => item.dataset.nav === target.key) ?? items[Math.min(target.index, items.length - 1)]
    found?.focus()
  }

  private onListKey(event: KeyboardEvent): void {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
    const target = event.target instanceof HTMLElement ? event.target : null
    const items = this.navItems()
    const index = target ? items.indexOf(target) : -1
    if (!target || index < 0) return
    const go = (next: HTMLElement | undefined): void => {
      event.preventDefault()
      next?.focus()
    }
    switch (event.key) {
      case 'ArrowDown': return go(items[Math.min(index + 1, items.length - 1)])
      case 'ArrowUp': return go(items[Math.max(index - 1, 0)])
      case 'Home': return go(items[0])
      case 'End': return go(items[items.length - 1])
      case 'ArrowRight':
      case 'ArrowLeft': return this.foldByKey(event, target)
      case 'Delete':
      case 'Backspace': return this.removeClosedByKey(event, target, items, index)
    }
  }

  private foldByKey(event: KeyboardEvent, target: HTMLElement): void {
    const projectId = target.dataset.sidebarProject
    if (!target.classList.contains('proj-name') || !projectId || this.filterText.trim() !== '') return
    const folded = this.lastState?.settings.foldedProjects.includes(projectId) === true
    if (folded === (event.key === 'ArrowRight')) toggleProjectExpanded(projectId)
    event.preventDefault()
  }

  private removeClosedByKey(event: KeyboardEvent, target: HTMLElement, items: HTMLElement[], index: number): void {
    const { agent, sessionId } = target.dataset
    if (!target.closest('.kept-session-row.closed') || !agent || !sessionId) return
    event.preventDefault()
    const sibling = items[index + 1]
    const next = sibling?.closest('.kept-session-row.closed') ? sibling : (items[index - 1] ?? sibling)
    this.restore = next?.dataset.nav ? { key: next.dataset.nav, index: Math.max(0, index - 1) } : null
    removeKeptSession(agent as AgentKind, sessionId)
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
    const entries = filterSidebar(orderProjects(state.settings.projects), views, state.settings.keptSessions, openSessionKeys(state), this.filterText)
    const projects = entries.map((entry) => entry.project)
    const signature = JSON.stringify([
      collapsed,
      state.view,
      focusedView?.pane.projectId,
      state.focusedId,
      projects.map((p) => [p.id, p.name, p.defaultAgent, p.pinned === true]),
      state.settings.foldedProjects,
      projects.map((p) => projectTodayLabel(state.usage.projectsToday[p.id])),
      views.map((v) => [v.pane.id, v.pane.projectId, v.title, v.status, v.agent, v.attention]),
      state.settings.keptSessions,
      state.settings.foldedClosedSessions,
      state.closedShowAll,
      state.settings.keptSessions.map((session) => [closedAgoShort(session.closedAt, state.now), closedDayLabel(session.closedAt, state.now)])
    ])
    if (signature === this.signature) return
    this.signature = signature
    this.el.classList.toggle('rail', collapsed)
    this.el.setAttribute('aria-label', collapsed ? 'Projects (collapsed)' : 'Projects')
    if (collapsed) this.renderRail(projects, views, focusedView?.pane.projectId)
    else this.renderFull(state, entries, views)
  }

  private renderRail(projects: Project[], views: PaneView[], activeProject?: string): void {
    clear(this.el)
    this.el.append(
      iconButton('Expand sidebar', ICONS.expand, () => toggleSidebar(), 'rail-btn'),
      h('div', { class: 'rail-divider' })
    )
    for (const project of projects) {
      const status = projectStatus(views.filter((view) => view.pane.projectId === project.id).map(viewState))
      const label = projectStatusLabel(project.name, status)
      const button = iconButton(label, ICONS.folderLarge, () => void startSession(project.id), 'rail-btn')
      button.classList.toggle('selected', project.id === activeProject)
      if (status.needs > 0) button.append(h('span', { class: 'rail-badge', 'aria-hidden': 'true' }, status.needs > 9 ? '9+' : String(status.needs)))
      else if (status.working > 0) button.append(h('span', { class: 'rail-dot', 'aria-hidden': 'true' }))
      this.el.append(button)
    }
  }

  private renderFull(state: AppState, entries: SidebarEntry<PaneView>[], views: PaneView[]): void {
    const hadFocus = document.activeElement === this.filter
    const prior = this.focusedNav()
    const target = prior ? (this.restore ?? prior) : null
    this.restore = null
    clear(this.el)
    clear(this.list)
    this.list.append(...this.needsGroup(state, views))
    const filtering = this.filterText.trim() !== ''
    for (const entry of entries) this.list.append(...this.projectRows(state, entry, filtering))
    if (entries.length === 0) {
      this.list.append(
        h('p', { class: 'proj-empty' }, state.settings.projects.length === 0 ? 'No projects yet.' : 'No project or session matches.')
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
        h('label', { for: 'sidebar-project-filter', class: 'sr-only' }, 'Filter projects and sessions'),
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
    else this.restoreFocus(target)
  }

  private projectRows(state: AppState, { project, views: own, closed }: SidebarEntry<PaneView>, filtering: boolean): HTMLElement[] {
    const collapsed = !filtering && state.settings.foldedProjects.includes(project.id)
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
      h('button', { class: 'proj-name', type: 'button', title: project.folder, 'data-nav': `p:${project.id}`, 'data-sidebar-project': project.id, onClick: () => void startSession(project.id) }, project.name),
      project.pinned === true ? h('span', { class: 'proj-pin', role: 'img', 'aria-label': 'Pinned', title: 'Pinned' }, icon(ICONS.pin)) : null,
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
            'data-nav': `s:${view.pane.id}`,
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
    rows.push(...this.closedRows(state, project, closed, filtering))
    return rows
  }

  private closedRows(state: AppState, project: Project, closed: KeptSession[], filtering: boolean): HTMLElement[] {
    if (closed.length === 0) return []
    const hidden = !filtering && state.settings.foldedClosedSessions.includes(project.id)
    const label = `Closed sessions (${closed.length})`
    const toggle = h(
      'button',
      {
        class: 'sess-group-label closed-toggle',
        type: 'button',
        'aria-expanded': String(!hidden),
        title: `${hidden ? 'Show' : 'Hide'} closed sessions in ${project.name}`,
        'data-nav': `ct:${project.id}`,
        onClick: () => toggleClosedSessions(project.id)
      },
      icon(hidden ? ICONS.chevronRight : ICONS.chevronDown),
      h('span', {}, label)
    )
    const head = h(
      'div',
      { class: 'closed-head' },
      toggle,
      iconButton(`Clear closed sessions in ${project.name}`, ICONS.eraser, () => void clearClosedSessions(project.id), 'small closed-clear')
    )
    if (hidden) return [head]
    const showAll = filtering || state.closedShowAll[project.id] === true
    const shown = showAll ? closed : closed.slice(0, CLOSED_PREVIEW_COUNT)
    const groups = groupClosedByDay(shown, state.now)
    const rows: HTMLElement[] = [head]
    for (const group of groups) {
      if (groups.length > 1) rows.push(h('div', { class: 'closed-day' }, group.label))
      for (const session of group.sessions) rows.push(this.closedRow(state, project, session))
    }
    if (!filtering && closed.length > CLOSED_PREVIEW_COUNT) {
      rows.push(h('button', { class: 'link closed-more', type: 'button', 'data-nav': `more:${project.id}`, onClick: () => toggleClosedShowAll(project.id) },
        showAll ? 'Show fewer' : `Show all ${closed.length}`))
    }
    return rows
  }

  private closedRow(state: AppState, project: Project, session: KeptSession): HTMLElement {
    const closedOn = new Date(session.closedAt).toLocaleString()
    return h('div', { class: 'kept-session-row closed' },
      h('button', { class: 'sess-row', type: 'button', title: `Resume ${session.title} (closed ${closedOn})`, 'data-nav': `c:${session.agent}:${session.sessionId}`, 'data-agent': session.agent, 'data-session-id': session.sessionId, onClick: () => void startSession(project.id, session.agent, session.sessionId, true, session.title) },
        agentMark(session.agent),
        h('span', { class: 'sess-name', dir: 'auto' }, session.title),
        h('span', { class: 'sess-ago', 'aria-label': `closed ${closedOn}` }, closedAgoShort(session.closedAt, state.now))),
      iconButton(`Remove ${session.title} from ${project.name}`, ICONS.close, () => removeKeptSession(session.agent, session.sessionId), 'small sess-close')
    )
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
          'data-nav': `n:${view.pane.id}`,
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
  private menuAnchor: HTMLElement | null = null

  private agentMenuButton(project: AppState['settings']['projects'][number]): HTMLElement {
    const button = iconButton(`Choose agent for ${project.name}`, ICONS.more, () => this.toggleMenu(button, project), 'small proj-agent-menu')
    button.setAttribute('aria-haspopup', 'menu')
    return button
  }

  // The menu's own button is left to toggleMenu, so a second click closes the menu instead of reopening it.
  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.menu && !this.menu.contains(target) && !this.menuAnchor?.contains(target)) this.closeMenu()
  }

  private closeMenu(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.menu?.remove()
    this.menu = null
    this.menuAnchor = null
  }

  private toggleMenu(anchor: HTMLElement, project: Project): void {
    const reopen = this.menuAnchor !== anchor
    if (this.menu) this.closeMenu()
    if (!reopen) return
    this.menuAnchor = anchor
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
    const stored = this.lastState?.settings.projects ?? []
    const act = (label: string, run: () => void): HTMLElement =>
      h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => { this.closeMenu(); run() } }, label)
    const arrange = [
      act(project.pinned === true ? 'Unpin' : 'Pin to top', () => pinProject(projectId, project.pinned !== true)),
      canMoveProject(stored, projectId, -1) ? act('Move up', () => moveProjectInList(projectId, -1)) : null,
      canMoveProject(stored, projectId, 1) ? act('Move down', () => moveProjectInList(projectId, 1)) : null
    ]
    const first = item('claude')
    this.menu = h(
      'div',
      { class: 'popover menu floating', role: 'menu' },
      first,
      item('codex'),
      item('gemini'),
      resume,
      h('div', { class: 'pv-menu-sep', role: 'separator' }),
      ...arrange
    )
    this.menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.closeMenu()
      anchor.focus()
    })
    document.body.appendChild(this.menu)
    // Kept inside the window, so the last project's menu opens upwards.
    placeNearAnchor(this.menu, anchor, 2)
    first.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0)
  }
}
