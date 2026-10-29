import { AGENT_NAMES, agentLabel, agentOf } from '../../shared/agents'
import { SIDEBAR_FILTER_EVENT, hideEmptyProjects, isFolded, monogram, projectSummary, railBadge, SIDEBAR_SORTS, sessionAge, sessionStatusLine, sidebarZones, sortProjects, waitingOnYou, type SidebarZones, type SidebarSort } from '../../shared/sidebarModel'
import { canDropProject, canMoveProject, orderProjects, seedOrder } from '../../shared/projectOrder'
import { projectStatus, projectStatusLabel } from '../../shared/projectStatus'
import { filterSidebar, type SidebarEntry } from '../../shared/sidebarFilter'
import { projectTodayLabel, projectTodayShort, projectTodayTooltip } from '../../shared/sessionCost'
import type { AgentKind, KeptSession, Project } from '../../shared/types'
import { addProject, clearClosedSessions, closePane, locateProject, focusPane, moveProjectFromDisplay, moveProjectInList, openResumePicker, openSessionKeys, pinProject, removeKeptSession, removeProject, renameKeptSession, renameSession, reopenKeptSessions, reorderProjectFromDisplay, setSidebarHideEmpty, setSidebarSort, showView, startSession, tagKeptSession, tagSession, toggleClosedSessions, toggleClosedShowAll, toggleProjectExpanded, toggleSidebar, updateProject } from '../actions'
import { CLOSED_PREVIEW_COUNT, closedAgoShort, closedDayLabel, closedUsageShort, closedUsageTooltip, groupClosedByDay, reopenGroupLabel } from '../../shared/keptSessions'
import { autoTag, autoTagSource, cleanSessionName, SESSION_NAME_MAX, type SessionTag } from '../../shared/sessionTags'
import type { PaneView } from '../derive'
import { clear, h, icon, iconButton } from '../dom'
import { enableDrag } from '../drag'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { crewSignature, identityMark } from './crewAvatar'
import { openFolderInFiles } from '../files/filesActions'
import { stateIcon } from './stateIcon'
import { SidebarMenu } from './sidebarMenu'
import { tagMenuItems, tagTooltip } from './sessionTagUi'
import { confirmDialog, promptDialog } from './dialogs'
import { lastOutputAt } from '../ptyActivity'
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

const NAV_SELECTOR = '.proj-toggle, .sess-row, .closed-toggle, .closed-more'

type ProjectZone = 'active' | 'pinned' | 'quiet' | 'all'

const viewState =(view: PaneView) => sessionState({ status: view.status, attention: view.attention })

// A session with no name yet shows its agent and number, not the project name its siblings share.
const sessionLabel = (view: PaneView): string => (view.named ? view.title : `${view.agent === 'shell' ? 'Terminal' : agentLabel(view.agent)} session ${view.index + 1}`)

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
  private filterOpen = false
  private focusFilterNext = false
  /** Quiet projects the user has expanded from their one-line row; not remembered across restarts. */
  private readonly quietOpen = new Set<string>()

  constructor() {
    this.filter.addEventListener('input', () => {
      this.filterText = this.filter.value
      this.signature = ''
      this.render(this.lastState, this.lastViews)
    })
    window.addEventListener(SIDEBAR_FILTER_EVENT, this.onFilterRequest)
    this.filter.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        if (this.filterText !== '') this.clearFilter()
        else this.closeFilter()
        return
      }
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
  private readonly popup = new SidebarMenu((key) => this.el.querySelector<HTMLElement>(`[data-menu-key="${key}"]`))

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
    if (event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (event.altKey) return this.moveProjectByKey(event, target)
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

  private moveProjectByKey(event: KeyboardEvent, target: HTMLElement | null): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const key = target?.dataset.nav
    if (!key?.startsWith('p:') || this.filterText.trim() !== '') return
    event.preventDefault()
    const id = key.slice(2)
    this.focusAfterRender(key)
    moveProjectFromDisplay(this.displayedIds, id, event.key === 'ArrowUp' ? -1 : 1)
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
    if (!target.classList.contains('proj-toggle') || !projectId || this.filterText.trim() !== '') return
    event.preventDefault()
    const quiet = target.closest('.proj-group')?.getAttribute('data-zone') === 'quiet'
    const folded = quiet ? !this.quietOpen.has(projectId) : this.lastState?.settings.foldedProjects.includes(projectId) === true
    if (folded !== (event.key === 'ArrowRight')) return
    if (quiet) this.toggleQuiet(projectId)
    else toggleProjectExpanded(projectId)
  }

  private removeClosedByKey(event: KeyboardEvent, target: HTMLElement, items: HTMLElement[], index: number): void {
    const { agent, sessionId } = target.dataset
    if (!target.closest('.kept-session-row.closed') || !agent || !sessionId) return
    event.preventDefault()
    const sibling = items[index + 1]
    const next = sibling?.closest('.kept-session-row.closed') ? sibling : (items[index - 1] ?? sibling)
    const restore = next?.dataset.nav ? { key: next.dataset.nav, index: Math.max(0, index - 1) } : null
    void this.confirmRemoveClosed(agent as AgentKind, sessionId, () => {
      this.restore = restore
    })
  }

  private async confirmRemoveClosed(agent: AgentKind, sessionId: string, beforeRemove?: () => void): Promise<void> {
    const state = this.lastState
    const kept = state?.settings.keptSessions.find((item) => item.agent === agent && item.sessionId === sessionId)
    if (!state || !kept) return
    const projectName = state.settings.projects.find((project) => project.id === kept.projectId)?.name ?? 'this project'
    const confirmed = await confirmDialog({
      title: `Remove ${kept.title} from ${projectName}?`,
      body: `This removes ${kept.title} from the closed list in the sidebar. The session stays on disk and can still be found with Resume. You can undo it right after.`,
      confirmLabel: `Remove ${kept.title}`
    })
    if (!confirmed) return
    beforeRemove?.()
    removeKeptSession(agent, sessionId)
  }

  private lastState: AppState | null = null
  private displayedIds: string[] = []
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
    const filtering = this.filterText.trim() !== ''
    const sorted = sortProjects(state.settings.projects, state.settings.sidebarSort, projectActivity(state, views))
    const all = sidebarZones(sorted.map((project) => ({ project, views: views.filter((view) => view.pane.projectId === project.id) })), false)
    this.displayedIds = [...all.active, ...all.pinned, ...all.quiet].map((entry) => entry.project.id)
    const found = filterSidebar(sorted, views, state.settings.keptSessions, openSessionKeys(state), this.filterText)
    const entries = filtering ? found : hideEmptyProjects(found, state.settings.sidebarHideEmpty)
    const hiddenEmpty = found.length - entries.length
    const projects = entries.map((entry) => entry.project)
    const signature = JSON.stringify([
      collapsed,
      state.view,
      focusedView?.pane.projectId,
      state.focusedId,
      projects.map((p) => [p.id, p.name, p.folder, p.defaultAgent, p.pinned === true, state.branches[p.folder] ?? null, state.missingProjects.includes(p.id)]),
      state.settings.foldedProjects,
      state.settings.sidebarSort,
      state.settings.sidebarHideEmpty,
      hiddenEmpty,
      this.filterOpen,
      projects.map((p) => projectTodayLabel(state.usage.projectsToday[p.id])),
      views.map((v) => [v.pane.id, v.pane.projectId, v.title, v.status, v.agent, v.attention, v.tag, v.tagAuto, sessionAge(viewActivity(v), state.now), v.info.ops?.running.length ?? 0, crewSignature(v)]),
      this.edit?.key,
      [...this.quietOpen],
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
    else this.renderFull(state, entries, views, hiddenEmpty)
    this.popup.reanchor()
  }

  private enableRailDrag(button: HTMLElement, project: Project): void {
    const projects = (): Project[] => seedOrder(this.lastState?.settings.projects ?? [], this.displayedIds)
    enableDrag<HTMLElement>(button, {
      ignore: '[data-no-drag]',
      targetAt: (x, y) => {
        const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.rail-mono')
        return hit?.dataset.dropProject && canDropProject(projects(), project.id, hit.dataset.dropProject) ? hit : null
      },
      mark: (target) => {
        for (const marked of this.el.querySelectorAll('.drop-before, .drop-after')) marked.classList.remove('drop-before', 'drop-after')
        if (!target) return
        const order = projects().map((item) => item.id)
        target.classList.add(order.indexOf(project.id) < order.indexOf(target.dataset.dropProject ?? '') ? 'drop-after' : 'drop-before')
      },
      drop: (target) => {
        if (target.dataset.dropProject) reorderProjectFromDisplay(this.displayedIds, project.id, target.dataset.dropProject)
      }
    })
  }

  private renderRail(projects: Project[], views: PaneView[], activeProject?: string): void {
    clear(this.el)
    this.el.append(
      iconButton('Expand sidebar', ICONS.expand, () => toggleSidebar(), 'rail-btn'),
      h('div', { class: 'rail-divider' })
    )
    for (const project of projects) {
      const states = views.filter((view) => view.pane.projectId === project.id).map(viewState)
      const status = projectStatus(states)
      const label = projectStatusLabel(project.name, status)
      const key = `fly:${project.id}`
      const button = h('button', { class: 'rail-btn rail-mono', type: 'button', 'aria-label': label, title: label, 'aria-haspopup': 'menu', 'data-menu-key': key, onClick: () => this.toggleFlyout(key, project) }, h('span', { class: 'rail-letters', 'aria-hidden': 'true' }, monogram(project.name)))
      button.classList.toggle('selected', project.id === activeProject)
      button.dataset.dropProject = project.id
      button.classList.add('reorderable')
      this.enableRailDrag(button, project)
      const badge = railBadge(states)
      if (badge) button.append(h('span', { class: `rail-badge${status.needs > 0 ? ' needs' : ''}`, 'aria-hidden': 'true' }, badge))
      this.el.append(button)
    }
    this.el.append(h('div', { class: 'rail-spacer' }), iconButton('Add project', ICONS.plus, () => void addProject(), 'rail-btn'))
  }

  private renderFull(state: AppState, entries: SidebarEntry<PaneView>[], views: PaneView[], hiddenEmpty: number): void {
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
    this.list.append(...this.waitingGroup(state, views))
    const filtering = this.filterText.trim() !== ''
    const zones = sidebarZones(entries, filtering)
    if (state.settings.projects.length > 0) this.list.append(this.sectionHead(state, zones.grouped && zones.active.length > 0 ? `Active · ${zones.active.length}` : 'All projects'))
    this.list.append(...this.zoneGroups(state, zones, filtering))
    if (entries.length === 0) {
      this.list.append(this.emptyState(state.settings.projects.length === 0, hiddenEmpty > 0))
    } else if (hiddenEmpty > 0) {
      this.list.append(h('button', { class: 'link sidebar-note', type: 'button', onClick: () => setSidebarHideEmpty(false) }, `${hiddenEmpty} project${hiddenEmpty === 1 ? '' : 's'} without sessions hidden. Show`))
    }
    const search = iconButton('Filter projects and sessions', ICONS.search, () => (this.filterOpen ? this.closeFilter() : this.openFilter()), 'sidebar-search')
    search.title = 'Filter projects and sessions (Ctrl+Shift+O)'
    search.setAttribute('aria-expanded', String(this.filterOpen))
    this.el.append(
      h(
        'div',
        { class: 'sidebar-head' },
        h('span', { class: 'sidebar-title' }, 'Projects'),
        search,
        iconButton('Add project', ICONS.plus, () => void addProject(), 'sidebar-add'),
        iconButton('Collapse sidebar', ICONS.collapse, () => toggleSidebar())
      ),
      ...(this.filterOpen
        ? [h('div', { class: 'filter' }, h('label', { for: 'sidebar-project-filter', class: 'sr-only' }, 'Filter projects and sessions'), icon(ICONS.search), this.filter)]
        : []),
      this.list,
      h(
        'div',
        { class: 'sidebar-foot' },
        h('button', { class: 'foot-btn', type: 'button', onClick: () => void addProject() }, icon(ICONS.plus), h('span', {}, 'Add project')),
        h('button', { class: 'foot-btn', type: 'button', 'aria-label': 'Manage projects', 'aria-current': state.view === 'projects' ? 'page' : undefined, onClick: () => showView('projects') }, h('span', {}, 'Manage'))
      )
    )
    if (hadFocus || this.focusFilterNext) this.filter.focus()
    else if (!this.focusRename(typing)) this.restoreFocus(target)
    this.focusFilterNext = false
    this.rebuilding = false
  }

  private openFilter(): void {
    this.filterOpen = true
    this.focusFilterNext = true
    this.signature = ''
    this.render(this.lastState, this.lastViews)
  }

  private closeFilter(): void {
    this.filterOpen = false
    this.filterText = ''
    this.filter.value = ''
    this.signature = ''
    this.render(this.lastState, this.lastViews)
    this.el.querySelector<HTMLElement>('.sidebar-search')?.focus()
  }

  /** The command and the header icon both land here; a collapsed rail opens first so the field has somewhere to be. */
  private readonly onFilterRequest = (): void => {
    if (this.lastState && isSidebarCollapsed(this.lastState)) toggleSidebar()
    this.openFilter()
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

  private emptyState(noProjects: boolean, hidden: boolean): HTMLElement {
    const action = noProjects
      ? h('button', { class: 'btn small primary', type: 'button', onClick: () => void addProject() }, 'Add a project')
      : hidden
        ? h('button', { class: 'btn small', type: 'button', onClick: () => setSidebarHideEmpty(false) }, 'Show all projects')
        : h('button', { class: 'btn small', type: 'button', onClick: () => this.clearFilter() }, 'Clear filter')
    const message = noProjects ? 'No projects yet.' : hidden ? 'No project has a session.' : 'No project or session matches.'
    const hint = noProjects ? 'A project is a folder your sessions start in.' : hidden ? 'Projects without sessions are hidden.' : 'Try a shorter word, or clear the filter.'
    return h('div', { class: 'sidebar-empty' }, h('p', { class: 'proj-empty' }, message), h('p', { class: 'sidebar-empty-hint' }, hint), action)
  }

  private clearFilter(): void {
    this.filter.value = ''
    this.filterText = ''
    this.signature = ''
    this.render(this.lastState, this.lastViews)
    this.filter.focus()
  }

  private sectionHead(state: AppState, label: string): HTMLElement {
    const sort = iconButton('Sort and filter projects', SORT_ICON, () => this.toggleSortMenu(state.settings.sidebarSort, state.settings.sidebarHideEmpty), 'small sidebar-sort')
    sort.setAttribute('aria-haspopup', 'menu')
    sort.dataset.menuKey = 'sort'
    return h('div', { class: 'side-sec' }, h('span', { class: 'side-sec-label' }, label), sort)
  }

  private toggleSortMenu(current: SidebarSort, hideEmpty: boolean): void {
    if (this.popup.isOpenFor('sort')) return this.popup.close()
    const sorts = SIDEBAR_SORTS.map(({ sort, label }) =>
      h('button', { class: 'menu-item', type: 'button', role: 'menuitemradio', 'aria-checked': String(sort === current), onClick: () => { this.popup.close(); setSidebarSort(sort) } },
        h('span', { class: 'menu-check', 'aria-hidden': 'true' }, sort === current ? '✓' : ''), label)
    )
    const hide = h('button', { class: 'menu-item', type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(hideEmpty), onClick: () => { this.popup.close(); setSidebarHideEmpty(!hideEmpty) } },
      h('span', { class: 'menu-check', 'aria-hidden': 'true' }, hideEmpty ? '✓' : ''), 'Hide projects without sessions')
    this.popup.open('sort', [...sorts, h('div', { class: 'pv-menu-sep', role: 'separator' }), hide], 'Sort and filter projects')
  }

  private zoneGroups(state: AppState, zones: SidebarZones<SidebarEntry<PaneView>>, filtering: boolean): HTMLElement[] {
    const group = (entry: SidebarEntry<PaneView>, zone: ProjectZone): HTMLElement =>
      h('div', { class: `proj-group zone-${zone}${zone === 'active' ? ' card' : ''}`, 'data-zone': zone }, ...this.projectRows(state, entry, filtering, zone))
    const groups = [...zones.active.map((entry) => group(entry, zones.grouped ? 'active' : 'all')), ...zones.pinned.map((entry) => group(entry, 'pinned'))]
    if (zones.quiet.length === 0) return groups
    if (groups.length > 0) groups.push(h('div', { class: 'side-sec quiet-sec' }, h('span', { class: 'side-sec-label' }, `No sessions · ${zones.quiet.length}`)))
    return [...groups, ...zones.quiet.map((entry) => group(entry, 'quiet'))]
  }

  private toggleQuiet(projectId: string): void {
    if (!this.quietOpen.delete(projectId)) this.quietOpen.add(projectId)
    this.focusAfterRender(`p:${projectId}`)
    this.signature = ''
    this.render(this.lastState, this.lastViews)
  }

  // A project whose folder is gone keeps its row and place in the list, with Locate to point it at the moved folder.
  private projectRows(state: AppState, entry: SidebarEntry<PaneView>, filtering: boolean, zone: ProjectZone): HTMLElement[] {
    const rows = this.projectRowsBody(state, entry, filtering, zone)
    if (!state.missingProjects.includes(entry.project.id)) return rows
    const project = entry.project
    rows[0].classList.add('proj-missing')
    const locate = h('button', { class: 'btn small', type: 'button', 'aria-label': `Locate the folder for ${project.name}`, onClick: () => void locateProject(project.id) }, 'Locate…')
    return [rows[0], h('div', { class: 'proj-missing-line' }, icon(ICONS.folder), h('span', { class: 'proj-missing-text' }, 'Folder not found'), locate), ...rows.slice(1)]
  }

  private projectRowsBody(state: AppState, { project, views: own, closed }: SidebarEntry<PaneView>, filtering: boolean, zone: ProjectZone): HTMLElement[] {
    const quiet = zone === 'quiet'
    const compact = quiet && !this.quietOpen.has(project.id)
    const collapsed = quiet ? compact : isFolded(state.settings.foldedProjects, project.id, filtering)
    const summary = projectSummary(own.map(viewState))
    const branch = state.branches[project.folder] ?? null
    const today = this.todayTotal(state, project.id)
    const branchEl = branch ? h('span', { class: 'proj-branch', dir: 'auto', title: `Branch ${branch}` }, branch) : null
    const sub = branch || today.length > 0 ? h('span', { class: 'proj-sub' }, branchEl, ...today.map((el) => (branch ? this.withDot(el) : el))) : null
    const toggle = h(
      'button',
      {
        class: 'proj-toggle',
        type: 'button',
        title: project.folder,
        'aria-expanded': String(!collapsed),
        'aria-label': `${collapsed ? 'Show' : 'Hide'} sessions for ${project.name}`,
        'data-nav': `p:${project.id}`,
        'data-sidebar-project': project.id,
        onClick: () => (quiet ? this.toggleQuiet(project.id) : toggleProjectExpanded(project.id))
      },
      ...(compact
        ? [h('span', { class: 'proj-name', dir: 'auto' }, project.name), branchEl]
        : [
            icon(collapsed ? ICONS.chevronRight : ICONS.chevronDown),
            h('span', { class: 'proj-text' },
              h('span', { class: 'proj-title' },
                h('span', { class: 'proj-name', dir: 'auto' }, project.name),
                project.pinned === true ? h('span', { class: 'proj-pin', role: 'img', 'aria-label': 'Pinned' }, icon(ICONS.pin)) : null
              ),
              sub)
          ])
    )
    if (compact) toggle.classList.add('quiet-toggle')
    const row = h(
      'div',
      { class: `proj-row${compact ? ' quiet-row' : ''}${filtering ? '' : ' reorderable'}`, 'data-drop-project': project.id },
      toggle,
      summary.text ? h('span', { class: `proj-count tone-${summary.tone}` }, summary.text) : null,
      h(
        'span',
        { class: 'proj-acts' },
        iconButton(`New ${AGENT_NAMES[agentOf(project)]} session in ${project.name}`, ICONS.plus, () => void startSession(project.id), 'small'),
        this.agentMenuButton(project)
      )
    )
    if (!filtering) this.enableProjectDrag(row, project, zone)
    const rows: HTMLElement[] = [row]
    if (collapsed) return rows
    if (own.length + closed.length === 0) {
      rows.push(h('div', { class: 'proj-hidden' }, 'No sessions. ', h('button', { class: 'link', type: 'button', onClick: () => void startSession(project.id) }, 'Start one')))
      return rows
    }
    for (const view of own) rows.push(this.openRow(state, project, view))
    rows.push(...this.closedRows(state, project, closed, filtering))
    return rows
  }

  // The project row of whichever group the pointer is over, with that group's zone.
  private projectRowAt(x: number, y: number): { row: HTMLElement; zone: string | undefined } | null {
    const group = document.elementFromPoint(x, y)?.closest<HTMLElement>('.proj-group') ?? null
    const row = group?.querySelector<HTMLElement>('.proj-row') ?? null
    return group && row ? { row, zone: group.dataset.zone } : null
  }

  private enableProjectDrag(row: HTMLElement, project: Project, zone: ProjectZone): void {
    const projects = (): Project[] => seedOrder(this.lastState?.settings.projects ?? [], this.displayedIds)
    enableDrag<HTMLElement>(row, {
      ignore: '.icon-btn, input',
      targetAt: (x, y) => {
        const hit = this.projectRowAt(x, y)
        const id = hit?.row.dataset.dropProject
        return hit && id && hit.zone === zone && canDropProject(projects(), project.id, id) ? hit.row : null
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
        reorderProjectFromDisplay(this.displayedIds, project.id, target.dataset.dropProject)
      }
    })
  }

  private openRow(state: AppState, project: Project, view: PaneView): HTMLElement {
    const key = `s:${view.pane.id}`
    const selected = view.pane.id === state.focusedId
    const sessionStateName = viewState(view)
    const status = sessionStatusLine(sessionStateName, view.info.ops?.running.length ?? 0)
    const age = sessionAge(viewActivity(view), state.now)
    const tip = [sessionLabel(view), status, view.tag ? tagTooltip(view.tag, view.tagAuto) : ''].filter(Boolean).join('\n')
    const main = this.edit?.key === key
      ? this.renameField(key, view.title, view.agent, selected)
      : h(
          'button',
          {
            class: `sess-row${selected ? ' selected' : ''}`,
            type: 'button',
            title: tip,
            'aria-current': selected ? 'true' : undefined,
            'data-nav': key,
            onClick: () => focusPane(view.pane.id)
          },
          identityMark(view),
          h('span', { class: 'sess-body' },
            h('span', { class: 'sess-line' }, h('span', { class: 'sess-name', dir: 'auto' }, sessionLabel(view))),
            h('span', { class: 'sess-meta' },
              h('span', { class: `sess-state state-${sessionStateName}` }, stateIcon(sessionStateName), h('span', { class: 'sess-state-word' }, status)),
              h('span', { class: 'sess-age', 'aria-label': `active ${age}` }, age)))
        )
    return h('div', { class: `kept-session-row${selected ? ' selected' : ''}` },
      main,
      this.sessionMenuButton(key, view.title, project, view.tagAuto ? null : view.tag, (tag) => tagSession(view.pane.id, tag), 'Close', () => void closePane(view.pane.id)),
      iconButton(`Close ${view.title} in ${project.name}`, ICONS.close, () => void closePane(view.pane.id), 'small sess-close')
    )
  }

  private closedRows(state: AppState, project: Project, closed: KeptSession[], filtering: boolean): HTMLElement[] {
    if (closed.length === 0) return []
    const hidden = !filtering && state.settings.foldedClosedSessions.includes(project.id)
    const label = `${closed.length} closed`
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
    const closedTag = session.tag ?? autoTag(session.branch ?? null, session.title)
    const closedSource = session.tag ? null : autoTagSource(session.branch ?? null, session.title)
    const tagLine = closedTag ? tagTooltip(closedTag, closedSource) : ''
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
      : h('button', { class: 'sess-row', type: 'button', title: [`Resume ${session.title} (closed ${closedOn})`, closedUsageTooltip(usage), tagLine].filter(Boolean).join('\n'), 'data-nav': key, 'data-agent': session.agent, 'data-session-id': session.sessionId, onClick: click },
          agentMark(session.agent),
          h('span', { class: 'sess-body' },
            h('span', { class: 'sess-line' }, h('span', { class: 'sess-name', dir: 'auto' }, session.title)),
            h('span', { class: 'sess-meta' },
              h('span', { class: 'sess-ago', 'aria-label': `closed ${closedOn}` }, closedAgoShort(session.closedAt, state.now)),
              used ? h('span', { class: 'sess-cost', 'aria-label': `used ${used}` }, used) : null)))
    return h('div', { class: 'kept-session-row closed' },
      main,
      this.sessionMenuButton(key, session.title, project, session.tag ?? null, (tag) => tagKeptSession(session.agent, session.sessionId, tag), 'Remove', () => void this.confirmRemoveClosed(session.agent, session.sessionId)),
      iconButton(`Remove ${session.title} from ${project.name}`, ICONS.close, () => void this.confirmRemoveClosed(session.agent, session.sessionId), 'small sess-close')
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

  private waitingGroup(state: AppState, views: PaneView[]): HTMLElement[] {
    const waiting = waitingOnYou(views.map((view) => ({ view, state: viewState(view), at: viewActivity(view) })))
    if (waiting.length === 0) return []
    const rows = waiting.map(({ view, at }) => {
      const project = state.settings.projects.find((p) => p.id === view.pane.projectId)
      const age = sessionAge(at, state.now)
      const selected = view.pane.id === state.focusedId
      return h(
        'div',
        { class: `kept-session-row waiting-row${selected ? ' selected' : ''}` },
        h(
          'button',
          {
            class: `sess-row needs-row${selected ? ' selected' : ''}`,
            type: 'button',
            title: project ? `${sessionLabel(view)}\n${project.name} · Needs you` : sessionLabel(view),
            'aria-label': `${sessionLabel(view)}${project ? ` in ${project.name}` : ''}, needs you`,
            'data-nav': `n:${view.pane.id}`,
            onClick: () => focusPane(view.pane.id)
          },
          identityMark(view),
          h('span', { class: 'sess-body' },
            h('span', { class: 'sess-line' }, h('span', { class: 'sess-name', dir: 'auto' }, sessionLabel(view)), h('span', { class: 'sess-age' }, age)),
            h('span', { class: 'sess-meta' },
              h('span', { class: 'sess-state state-needs' }, stateIcon('needs'), h('span', { class: 'sess-state-word' }, 'Needs you')),
              project ? h('span', { class: 'needs-project' }, project.name) : null))
        )
      )
    })
    const hint = h('kbd', { class: 'kbd sidebar-kbd', title: 'Jump to the next session that needs you' }, 'Ctrl Shift J')
    return [h('section', { class: 'needs-group', 'aria-label': 'Waiting on you' }, h('div', { class: 'side-sec needs' }, h('span', { class: 'side-sec-label' }, 'Waiting on you'), h('span', { class: 'side-sec-count' }, String(waiting.length)), hint), ...rows)]
  }

  private withDot(el: HTMLElement): HTMLElement {
    el.prepend('· ')
    return el
  }

  private todayTotal(state: AppState, projectId: string): HTMLElement[] {
    const today = state.usage.projectsToday[projectId]
    const short = projectTodayShort(today)
    const label = projectTodayLabel(today)
    return short && label ? [h('span', { class: 'proj-today', title: projectTodayTooltip(today), 'aria-label': label }, `${short} today`)] : []
  }

  private agentMenuButton(project: Project): HTMLElement {
    const key = `pm:${project.id}`
    const button = iconButton(`Project actions for ${project.name}`, ICONS.more, () => this.toggleMenu(key, project), 'small proj-agent-menu')
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

  private async renameProject(project: Project): Promise<void> {
    const name = await promptDialog({
      title: `Rename ${project.name}`,
      label: 'Project name',
      initial: project.name,
      confirmLabel: 'Rename',
      validate: (value) => (value.trim() === '' ? 'Enter a name.' : null)
    })
    if (name && name.trim() !== project.name) updateProject(project.id, { name: name.trim() })
  }

  private toggleFlyout(key: string, project: Project): void {
    if (this.popup.isOpenFor(key)) return this.popup.close()
    const state = this.lastState
    const own = this.lastViews.filter((view) => view.pane.projectId === project.id)
    const branch = state?.branches[project.folder] ?? null
    const sessions = own.map((view) => {
      const name = viewState(view)
      const status = sessionStatusLine(name, view.info.ops?.running.length ?? 0)
      return h(
        'button',
        { class: 'menu-item fly-session', type: 'button', role: 'menuitem', title: `${view.title}\n${status}`, onClick: () => { this.popup.close(); focusPane(view.pane.id) } },
        identityMark(view),
        h('span', { class: 'fly-body' },
          h('span', { class: 'fly-title', dir: 'auto' }, sessionLabel(view)),
          h('span', { class: `sess-state state-${name}` }, stateIcon(name), h('span', { class: 'sess-state-word' }, status)))
      )
    })
    const start = h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => { this.popup.close(); void startSession(project.id) } }, `New ${AGENT_NAMES[agentOf(project)]} session`)
    this.popup.open(
      key,
      [
        h('div', { class: 'fly-head' }, h('span', { class: 'fly-project' }, project.name), branch ? h('span', { class: 'proj-branch' }, branch) : null),
        ...(sessions.length > 0 ? sessions : [h('div', { class: 'fly-empty' }, 'No sessions')]),
        h('div', { class: 'pv-menu-sep', role: 'separator' }),
        start
      ],
      `Sessions in ${project.name}`,
      'rail-flyout'
    )
  }

  private toggleMenu(key: string, project: Project): void {
    if (this.popup.isOpenFor(key)) return this.popup.close()
    const projectId = project.id
    const item = (label: string, run: () => void, mark?: HTMLElement | null): HTMLElement =>
      h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => { this.popup.close(); run() } }, mark, label)
    const agentItem = (agent: AgentKind): HTMLElement => item(`${AGENT_NAMES[agent]} session`, () => void startSession(projectId, agent), agentMark(agent))
    const stored = this.lastState?.settings.projects ?? []
    const manual = this.lastState?.settings.sidebarSort === 'manual'
    // The rows are rebuilt after these, so focus goes back to the project's name instead of being lost with the menu.
    const arrange = (label: string, run: () => void): HTMLElement => item(label, () => { this.focusAfterRender(`p:${projectId}`); run() })
    this.popup.open(key, [
      agentItem('claude'),
      agentItem('codex'),
      agentItem('gemini'),
      item(`Resume in ${project.name}…`, () => openResumePicker(projectId)),
      item('Open in Files', () => openFolderInFiles({ projectId, folder: project.folder })),
      item('Open terminal here', () => void startSession(projectId, 'shell')),
      h('div', { class: 'pv-menu-sep', role: 'separator' }),
      arrange(project.pinned === true ? 'Unpin' : 'Pin to top', () => pinProject(projectId, project.pinned !== true)),
      manual && canMoveProject(stored, projectId, -1) ? arrange('Move up', () => moveProjectInList(projectId, -1)) : null,
      manual && canMoveProject(stored, projectId, 1) ? arrange('Move down', () => moveProjectInList(projectId, 1)) : null,
      item('Rename…', () => void this.renameProject(project)),
      h('div', { class: 'pv-menu-sep', role: 'separator' }),
      h('button', { class: 'menu-item danger', type: 'button', role: 'menuitem', onClick: () => { this.popup.close(); void removeProject(projectId) } }, `Remove ${project.name} from Dawsha…`)
    ], `Actions for ${project.name}`)
  }
}

const SORT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16M3 17l3 3 3-3M13 6h8M13 12h6M13 18h4"/></svg>'

const FRESH_BUCKET_MS = 5 * 60_000

/** When a session last did something: its latest terminal output, else when it started. */
function viewActivity(view: PaneView): number {
  const tab = view.pane.tabs.find((item) => item.id === view.primaryTabId)
  return lastOutputAt(view.primaryTabId) ?? tab?.startedAt ?? 0
}

/** Latest activity per project in coarse buckets, so the Recent order moves when work moves, not on every line of output. */
function projectActivity(state: AppState, views: PaneView[]): Record<string, number> {
  const activity: Record<string, number> = {}
  const note = (projectId: string, at: number): void => {
    const bucket = Math.floor(at / FRESH_BUCKET_MS) * FRESH_BUCKET_MS
    if (bucket > (activity[projectId] ?? 0)) activity[projectId] = bucket
  }
  for (const view of views) note(view.pane.projectId, viewActivity(view))
  for (const session of state.settings.keptSessions) note(session.projectId, session.closedAt)
  return activity
}
