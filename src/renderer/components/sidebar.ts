import { AGENT_NAMES, agentOf } from '../../shared/agents'
import { canDropProject, canMoveProject, orderProjects } from '../../shared/projectOrder'
import { projectStatus, projectStatusLabel } from '../../shared/projectStatus'
import { filterSidebar, type SidebarEntry } from '../../shared/sidebarFilter'
import { projectTodayLabel, projectTodayShort, projectTodayTooltip } from '../../shared/sessionCost'
import type { AgentKind, KeptSession, Project } from '../../shared/types'
import { clearClosedSessions, closePane, focusPane, moveProjectInList, openResumePicker, openSessionKeys, pinProject, removeKeptSession, renameKeptSession, renameSession, reopenKeptSessions, reorderProject, showView, startSession, tagKeptSession, tagSession, toggleClosedSessions, toggleClosedShowAll, toggleProjectExpanded, toggleSidebar } from '../actions'
import { CLOSED_PREVIEW_COUNT, closedAgoShort, closedDayLabel, closedUsageShort, closedUsageTooltip, groupClosedByDay, reopenGroupLabel } from '../../shared/keptSessions'
import { autoTag, cleanSessionName, SESSION_NAME_MAX, type SessionTag } from '../../shared/sessionTags'
import type { PaneView } from '../derive'
import { clear, h, icon, iconButton } from '../dom'
import { enableDrag } from '../drag'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { stateIcon } from './stateIcon'
import { SidebarMenu } from './sidebarMenu'
import { tagChip, tagMenuItems } from './sessionTagUi'
import './sidebar.css'
import { SESSION_STATE_LABELS, sessionState } from '../../shared/sessionState'
import { needsCount } from '../../shared/attentionBadge'
import { syncAttentionBadge } from '../attentionBadge'
import type { AppState } from '../state'

export function isSidebarCollapsed(state: AppState): boolean {
  const maximized = state.view === 'grid' && state.maximizedId !== null
  return state.sidebarOverride ?? (maximized || state.settings.sidebarCollapsed)
}

// How long a click on a closed session waits for a second one, which would rename it instead of resuming it.
const DOUBLE_CLICK_MS = 280

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
    this.list.addEventListener('dblclick', (event) => this.onListDoubleClick(event))
    this.list.addEventListener('contextmenu', (event) => this.onListContextMenu(event))
  }

  private restore: { key: string; index: number } | null = null
  /** Focus to give back after an action rebuilds the rows; it lapses so a later, unrelated render never steals focus. */
  private pending: { key: string; until: number } | null = null
  private edit: { key: string } | null = null
  private rebuilding = false
  private resumeTimer = 0
  private readonly popup = new SidebarMenu((key) => this.list.querySelector<HTMLElement>(`[data-menu-key="${key}"]`))

  private focusAfterRender(key: string): void {
    this.pending = { key, until: Date.now() + 1000 }
  }

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
      case 'F2': return this.renameByKey(event, target)
      case 'Delete':
      case 'Backspace': return this.removeClosedByKey(event, target, items, index)
    }
  }

  private renameByKey(event: KeyboardEvent, target: HTMLElement): void {
    const key = target.dataset.nav
    if (!key || !/^[sc]:/.test(key)) return
    event.preventDefault()
    this.startRename(key)
  }

  private onListDoubleClick(event: MouseEvent): void {
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.sess-row[data-nav]') : null
    const key = row?.dataset.nav
    if (!key || !/^[sc]:/.test(key)) return
    window.clearTimeout(this.resumeTimer)
    this.startRename(key)
  }

  private onListContextMenu(event: MouseEvent): void {
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.kept-session-row') : null
    const button = row?.querySelector<HTMLElement>('.sess-more')
    if (!row || !button) return
    event.preventDefault()
    button.click()
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
      views.map((v) => [v.pane.id, v.pane.projectId, v.title, v.status, v.agent, v.attention, v.tag, v.tagAuto]),
      this.edit?.key,
      state.settings.keptSessions.map((session) => closedUsageShort(state.usage.sessions[session.sessionId])),
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
    const field = this.list.querySelector<HTMLInputElement>('.sess-rename')
    const typing = field ? { value: field.value, start: field.selectionStart, end: field.selectionEnd, focused: document.activeElement === field } : null
    const prior = this.focusedNav()
    const pending = this.pending && this.pending.until > Date.now() ? { key: this.pending.key, index: 0 } : null
    const target = this.restore ?? pending ?? prior
    this.restore = null
    this.pending = null
    this.rebuilding = true
    clear(this.el)
    clear(this.list)
    this.list.append(...this.needsGroup(state, views))
    const filtering = this.filterText.trim() !== ''
    for (const entry of entries) this.list.append(...this.projectRows(state, entry, filtering))
    if (entries.length === 0) {
      this.list.append(this.emptyState(state.settings.projects.length === 0))
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
    else if (!this.focusRename(typing)) this.restoreFocus(target)
    this.rebuilding = false
  }

  // A rename in progress survives the rebuild: same text, same caret, same focus.
  private focusRename(typing: { value: string; start: number | null; end: number | null; focused: boolean } | null): boolean {
    const input = this.list.querySelector<HTMLInputElement>('.sess-rename')
    if (!input) return false
    if (typing) {
      input.value = typing.value
      if (!typing.focused) return false
      input.focus()
      input.setSelectionRange(typing.start ?? typing.value.length, typing.end ?? typing.value.length)
      return true
    }
    input.focus()
    input.select()
    return true
  }

  private emptyState(noProjects: boolean): HTMLElement {
    const action = noProjects
      ? h('button', { class: 'btn small primary', type: 'button', onClick: () => showView('projects') }, 'Add a project')
      : h('button', { class: 'btn small', type: 'button', onClick: () => this.clearFilter() }, 'Clear filter')
    return h(
      'div',
      { class: 'sidebar-empty' },
      h('p', { class: 'proj-empty' }, noProjects ? 'No projects yet.' : 'No project or session matches.'),
      h('p', { class: 'sidebar-empty-hint' }, noProjects ? 'A project is a folder your sessions start in.' : 'Try a shorter word, or clear the filter.'),
      action
    )
  }

  private clearFilter(): void {
    this.filter.value = ''
    this.filterText = ''
    this.signature = ''
    this.render(this.lastState, this.lastViews)
    this.filter.focus()
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
      { class: 'proj-row', 'data-drop-project': project.id },
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
    if (!filtering) this.enableProjectDrag(row, project)
    const rows: HTMLElement[] = [row]
    if (collapsed) {
      if (own.length > 0) rows.push(h('div', { class: 'proj-hidden' }, `${own.length} session${own.length === 1 ? '' : 's'} hidden`))
      return rows
    }
    for (const view of own) rows.push(this.openRow(state, project, view))
    rows.push(...this.closedRows(state, project, closed, filtering))
    return rows
  }

  // The row a pointer is over, or the project a session row belongs to: rows are flat siblings, so walk back to the project's own row.
  private projectRowAt(x: number, y: number): HTMLElement | null {
    let node = document.elementFromPoint(x, y)?.closest<HTMLElement>('.proj-list > *') ?? null
    while (node && !node.classList.contains('proj-row')) node = node.previousElementSibling as HTMLElement | null
    return node
  }

  private enableProjectDrag(row: HTMLElement, project: Project): void {
    const projects = (): Project[] => this.lastState?.settings.projects ?? []
    enableDrag<HTMLElement>(row, {
      ignore: '.icon-btn, input',
      targetAt: (x, y) => {
        const hit = this.projectRowAt(x, y)
        return hit?.dataset.dropProject && canDropProject(projects(), project.id, hit.dataset.dropProject) ? hit : null
      },
      mark: (target) => {
        for (const marked of this.list.querySelectorAll('.drop-before, .drop-after')) marked.classList.remove('drop-before', 'drop-after')
        if (!target) return
        const order = projects().map((item) => item.id)
        target.classList.add(order.indexOf(project.id) < order.indexOf(target.dataset.dropProject ?? '') ? 'drop-after' : 'drop-before')
      },
      drop: (target) => {
        if (!target.dataset.dropProject) return
        this.focusAfterRender(`p:${project.id}`)
        reorderProject(project.id, target.dataset.dropProject)
      }
    })
  }

  private openRow(state: AppState, project: Project, view: PaneView): HTMLElement {
    const key = `s:${view.pane.id}`
    const selected = view.pane.id === state.focusedId
    const sessionStateName = viewState(view)
    const stateLabel = SESSION_STATE_LABELS[sessionStateName]
    const main = this.edit?.key === key
      ? this.renameField(key, view.title, view.agent, selected)
      : h(
          'button',
          {
            class: `sess-row${selected ? ' selected' : ''}`,
            type: 'button',
            'aria-current': selected ? 'true' : undefined,
            'data-nav': key,
            onClick: () => focusPane(view.pane.id)
          },
          agentMark(view.agent),
          h('span', { class: 'sess-body' },
            h('span', { class: 'sess-line' }, h('span', { class: 'sess-name', dir: 'auto' }, view.title), view.tag ? tagChip(view.tag, true, view.tagAuto) : null),
            h('span', { class: 'sess-meta' },
              h('span', { class: `sess-state state-${sessionStateName}`, title: stateLabel }, stateIcon(sessionStateName), h('span', { class: 'sess-state-word' }, stateLabel))))
        )
    return h('div', { class: `kept-session-row${selected ? ' selected' : ''}`, 'data-tag': view.tag ?? undefined },
      main,
      this.sessionMenuButton(key, view.title, project, view.tag, (tag) => tagSession(view.pane.id, tag), 'Close', () => void closePane(view.pane.id)),
      iconButton(`Close ${view.title} in ${project.name}`, ICONS.close, () => void closePane(view.pane.id), 'small sess-close')
    )
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
      // One day on its own needs no label, but a handful of sessions can still be reopened together.
      const labelled = groups.length > 1
      if (labelled || group.sessions.length > 1) {
        const reopen = h('button', { class: 'link closed-reopen', type: 'button', 'aria-label': reopenGroupLabel(group.sessions.length, group.label, project.name), onClick: () => void reopenKeptSessions(project, group.sessions, group.label) }, 'Reopen all')
        rows.push(h('div', { class: 'closed-day-row' }, labelled ? h('div', { class: 'closed-day' }, group.label) : null, reopen))
      }
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
    const key = `c:${session.agent}:${session.sessionId}`
    const usage = state.usage.sessions[session.sessionId]
    const used = closedUsageShort(usage)
    const closedTag = session.tag ?? autoTag(null, session.title)
    const resume = (): void => void startSession(project.id, session.agent, session.sessionId, true, session.title, session)
    // A double click renames, so a mouse click waits a moment to see whether a second one follows.
    const click = (event: Event): void => {
      window.clearTimeout(this.resumeTimer)
      const clicks = (event as MouseEvent).detail
      if (clicks === 0) resume()
      else if (clicks === 1) this.resumeTimer = window.setTimeout(resume, DOUBLE_CLICK_MS)
    }
    const main = this.edit?.key === key
      ? this.renameField(key, session.title, session.agent, false)
      : h('button', { class: 'sess-row', type: 'button', title: [`Resume ${session.title} (closed ${closedOn})`, closedUsageTooltip(usage)].filter(Boolean).join('\n'), 'data-nav': key, 'data-agent': session.agent, 'data-session-id': session.sessionId, onClick: click },
          agentMark(session.agent),
          h('span', { class: 'sess-body' },
            h('span', { class: 'sess-line' }, h('span', { class: 'sess-name', dir: 'auto' }, session.title), closedTag ? tagChip(closedTag, true, session.tag ? null : 'conversation') : null),
            h('span', { class: 'sess-meta' },
              h('span', { class: 'sess-ago', 'aria-label': `closed ${closedOn}` }, closedAgoShort(session.closedAt, state.now)),
              used ? h('span', { class: 'sess-cost', 'aria-label': `used ${used}` }, used) : null)))
    return h('div', { class: 'kept-session-row closed', 'data-tag': closedTag ?? undefined },
      main,
      this.sessionMenuButton(key, session.title, project, session.tag ?? null, (tag) => tagKeptSession(session.agent, session.sessionId, tag), 'Remove', () => removeKeptSession(session.agent, session.sessionId)),
      iconButton(`Remove ${session.title} from ${project.name}`, ICONS.close, () => removeKeptSession(session.agent, session.sessionId), 'small sess-close')
    )
  }

  private renameField(key: string, title: string, agent: AgentKind | 'shell', selected: boolean): HTMLElement {
    const input = h('input', { class: 'text-input sess-rename', type: 'text', dir: 'auto', maxlength: SESSION_NAME_MAX, value: title, 'aria-label': `Rename ${title}`, autocomplete: 'off', spellcheck: false })
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return
      if (event.key === 'Enter') {
        event.preventDefault()
        this.finishRename(input.value, key, true)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.finishRename(input.value, key, false)
      }
    })
    input.addEventListener('blur', () => {
      if (!this.rebuilding) this.finishRename(input.value, key, true)
    })
    return h('div', { class: `sess-row editing${selected ? ' selected' : ''}` }, agentMark(agent), input)
  }

  private startRename(key: string): void {
    if (this.edit?.key === key) return
    this.edit = { key }
    this.signature = ''
    this.render(this.lastState, this.lastViews)
  }

  private currentTitle(key: string): string | null {
    const [kind, ...rest] = key.split(':')
    if (kind === 's') return this.lastViews.find((view) => view.pane.id === rest[0])?.title ?? null
    return this.lastState?.settings.keptSessions.find((item) => item.agent === rest[0] && item.sessionId === rest[1])?.title ?? null
  }

  private finishRename(raw: string, key: string, save: boolean): void {
    if (this.edit?.key !== key) return
    this.edit = null
    const name = cleanSessionName(raw)
    this.focusAfterRender(key)
    if (save && name && name !== this.currentTitle(key)) {
      const [kind, ...rest] = key.split(':')
      if (kind === 's') renameSession(rest[0], name)
      else renameKeptSession(rest[0] as AgentKind, rest[1], name)
    }
    this.signature = ''
    this.render(this.lastState, this.lastViews)
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

  private agentMenuButton(project: Project): HTMLElement {
    const key = `pm:${project.id}`
    const button = iconButton(`Choose agent for ${project.name}`, ICONS.more, () => this.toggleMenu(key, project), 'small proj-agent-menu')
    button.setAttribute('aria-haspopup', 'menu')
    button.dataset.menuKey = key
    return button
  }

  private sessionMenuButton(navKey: string, title: string, project: Project, tag: SessionTag | null, setTag: (tag: SessionTag | null) => void, removeLabel: string, remove: () => void): HTMLElement {
    const key = `sm:${navKey}`
    const button = iconButton(`Actions for ${title} in ${project.name}`, ICONS.more, () => this.toggleSessionMenu(key, navKey, title, tag, setTag, removeLabel, remove), 'small sess-more')
    button.setAttribute('aria-haspopup', 'menu')
    button.dataset.menuKey = key
    return button
  }

  private toggleSessionMenu(key: string, navKey: string, title: string, tag: SessionTag | null, setTag: (tag: SessionTag | null) => void, removeLabel: string, remove: () => void): void {
    if (this.popup.isOpenFor(key)) return this.popup.close()
    const rename = h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => { this.popup.close(); this.startRename(navKey) } }, 'Rename')
    const tags = tagMenuItems(tag, (next) => { this.popup.close(); this.focusAfterRender(navKey); setTag(next) })
    const drop = h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => { this.popup.close(); remove() } }, removeLabel)
    this.popup.open(key, [rename, h('div', { class: 'pv-menu-sep', role: 'separator' }), ...tags, h('div', { class: 'pv-menu-sep', role: 'separator' }), drop], `Actions for ${title}`)
  }

  private toggleMenu(key: string, project: Project): void {
    if (this.popup.isOpenFor(key)) return this.popup.close()
    const projectId = project.id
    const item = (label: string, run: () => void, mark?: HTMLElement | null): HTMLElement =>
      h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => { this.popup.close(); run() } }, mark, label)
    const agentItem = (agent: AgentKind): HTMLElement => item(`${AGENT_NAMES[agent]} session`, () => void startSession(projectId, agent), agentMark(agent))
    const stored = this.lastState?.settings.projects ?? []
    // The rows are rebuilt after these, so focus goes back to the project's name instead of being lost with the menu.
    const arrange = (label: string, run: () => void): HTMLElement => item(label, () => { this.focusAfterRender(`p:${projectId}`); run() })
    this.popup.open(key, [
      agentItem('claude'),
      agentItem('codex'),
      agentItem('gemini'),
      item(`Resume in ${project.name}…`, () => openResumePicker(projectId)),
      h('div', { class: 'pv-menu-sep', role: 'separator' }),
      arrange(project.pinned === true ? 'Unpin' : 'Pin to top', () => pinProject(projectId, project.pinned !== true)),
      canMoveProject(stored, projectId, -1) ? arrange('Move up', () => moveProjectInList(projectId, -1)) : null,
      canMoveProject(stored, projectId, 1) ? arrange('Move down', () => moveProjectInList(projectId, 1)) : null
    ], `Actions for ${project.name}`)
  }
}
