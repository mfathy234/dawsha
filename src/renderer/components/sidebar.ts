import { AGENT_NAMES, agentOf } from '../../shared/agents'
import { SIDEBAR_FILTER_EVENT, hideEmptyProjects, isFolded, monogram, railBadge, SIDEBAR_SORTS, sessionStatusLine, sidebarZones, sortProjects, waitingOnYou, type SidebarZones, type SidebarSort } from '../../shared/sidebarModel'
import { canDropProject, canMoveProject, orderProjects, seedOrder } from '../../shared/projectOrder'
import { projectStatus, projectStatusLabel } from '../../shared/projectStatus'
import { filterSidebar, type SidebarEntry } from '../../shared/sidebarFilter'
import type { AgentKind, KeptSession, Project } from '../../shared/types'
import { closedSummary } from '../../shared/sessionLine'
import { editSpendLimit } from '../spendActions'
import { openWorktreeCleanup } from '../worktreeCleanupActions'
import { addProject, closePane, locateProject, focusPane, moveProjectFromDisplay, moveProjectInList, openResumePicker, openSessionKeys, pinProject, removeProject, renameSession, reorderProjectFromDisplay, setSidebarHideEmpty, setSidebarSort, showView, startSession, tagSession, toggleProjectExpanded, toggleSidebar, updateProject } from '../actions'
import { cleanSessionName, SESSION_NAME_MAX, type SessionTag } from '../../shared/sessionTags'
import { editTurnChecks } from './turnChecksDialog'
import type { PaneView } from '../derive'
import { clear, h, icon, iconButton } from '../dom'
import { enableDrag } from '../drag'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { crewSignature, identityMark } from './crewAvatar'
import { projectActivity, SORT_ICON, viewActivity } from './sidebarActivity'
import { projectDots, rowFacts, sessionLabel, sessionRowButton, viewState, waitingRowButton, type RowFacts } from './sidebarRows'
import { sessionNotesVersion } from '../sessionNotes'
import { openFolderInFiles } from '../files/filesActions'
import { stateIcon } from './stateIcon'
import { SidebarMenu } from './sidebarMenu'
import { tagMenuItems } from './sessionTagUi'
import { promptDialog } from './dialogs'
import './sidebar.css'
import './sidebarRoomy.css'
import { needsCount } from '../../shared/attentionBadge'
import { syncAttentionBadge } from '../attentionBadge'
import type { AppState } from '../state'

export function isSidebarCollapsed(state: AppState): boolean {
  const maximized = state.view === 'grid' && state.maximizedId !== null
  return state.sidebarOverride ?? (maximized || state.settings.sidebarCollapsed)
}

const NAV_SELECTOR = '.proj-toggle, .sess-row, .closed-line'

type ProjectZone = 'active' | 'pinned' | 'quiet' | 'all'

export class SidebarComponent {
  readonly el = h('aside', { class: 'sidebar', 'aria-label': 'Projects' })
  private readonly filter = h('input', {
    id: 'sidebar-project-filter',
    class: 'text-input',
    type: 'text',
    placeholder: 'Find a session',
    autocomplete: 'off'
  })
  private readonly list = h('div', { class: 'proj-list' })
  private signature = ''
  private filterText = ''
  private focusFilterNext = false
  /** Quiet projects the user has expanded from their one-line row; not remembered across restarts. */
  private readonly quietOpen = new Set<string>()

  constructor() {
    this.filter.classList.remove('text-input')
    this.filter.classList.add('sb-find-input')
    this.filter.setAttribute('dir', 'auto')
    this.filter.setAttribute('aria-label', 'Find a session or project')
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
        else this.filter.blur()
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
  }

  private restore: { key: string; index: number } | null = null
  /** Focus to give back after an action rebuilds the rows; it lapses so a later, unrelated render never steals focus. */
  private pending: { key: string; until: number } | null = null
  private edit: { key: string } | null = null
  private rebuilding = false
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
    if (!key?.startsWith('s:')) return
    event.preventDefault()
    this.startRename(key)
  }

  private onListDoubleClick(event: MouseEvent): void {
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.sess-row[data-nav]') : null
    const key = row?.dataset.nav
    if (!key?.startsWith('s:')) return
    this.startRename(key)
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

  private lastState: AppState | null = null
  private displayedIds: string[] = []
  private lastViews: PaneView[] = []
  private facts = new Map<string, RowFacts>()

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
    this.facts = new Map(views.map((view) => [view.pane.id, rowFacts(state, view)]))
    const signature = JSON.stringify([
      collapsed,
      state.view,
      focusedView?.pane.projectId,
      state.focusedId,
      projects.map((p) => [p.id, p.name, p.folder, p.defaultAgent, p.pinned === true, state.missingProjects.includes(p.id)]),
      state.settings.foldedProjects,
      state.settings.sidebarSort,
      state.settings.sidebarHideEmpty,
      hiddenEmpty,
      views.map((v) => [v.pane.id, v.pane.projectId, v.title, v.status, v.agent, v.attention, v.tag, v.tagAuto, v.branch, this.facts.get(v.pane.id)?.line, this.facts.get(v.pane.id)?.time, crewSignature(v)]),
      this.edit?.key,
      [...this.quietOpen],
      sessionNotesVersion(),
      entries.map((entry) => closedSummary(entry.closed.map((session) => session.closedAt), state.now))
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
    const selection = hadFocus ? { start: this.filter.selectionStart, end: this.filter.selectionEnd } : null
    clear(this.el)
    clear(this.list)
    const waiting = this.waitingGroup(state, views)
    this.list.append(...waiting.rows)
    const filtering = this.filterText.trim() !== ''
    const zones = sidebarZones(entries, filtering)
    if (state.settings.projects.length > 0) this.list.append(this.sectionHead(state, 'Projects'))
    this.list.append(...this.zoneGroups(state, zones, filtering, waiting.ids))
    if (entries.length === 0) {
      this.list.append(this.emptyState(state.settings.projects.length === 0, hiddenEmpty > 0))
    } else if (hiddenEmpty > 0) {
      this.list.append(h('button', { class: 'link sidebar-note', type: 'button', onClick: () => setSidebarHideEmpty(false) }, `${hiddenEmpty} project${hiddenEmpty === 1 ? '' : 's'} without sessions hidden. Show`))
    }
    this.el.append(
      h('div', { class: 'sidebar-head' }, this.findField(), iconButton('Add project', ICONS.plus, () => void addProject(), 'sidebar-add'), iconButton('Collapse sidebar', ICONS.collapse, () => toggleSidebar())),
      this.list,
      h(
        'div',
        { class: 'sidebar-foot' },
        h('button', { class: 'foot-btn', type: 'button', onClick: () => void addProject() }, icon(ICONS.plus), h('span', {}, 'Add project')),
        h('button', { class: 'foot-btn', type: 'button', 'aria-label': 'Manage projects', 'aria-current': state.view === 'projects' ? 'page' : undefined, onClick: () => showView('projects') }, h('span', {}, 'Manage'))
      )
    )
    if (hadFocus || this.focusFilterNext) {
      this.filter.focus()
      if (selection && selection.start !== null && selection.end !== null) this.filter.setSelectionRange(selection.start, selection.end)
    } else if (!this.focusRename(typing)) this.restoreFocus(target)
    this.focusFilterNext = false
    this.rebuilding = false
  }

  /** The find field at the top: filters sessions and projects as you type. Ctrl+K stays the palette and is shown in quiet grey. */
  private findField(): HTMLElement {
    return h(
      'label',
      { class: 'sb-find', title: 'Find a session or project (Ctrl+Shift+O)' },
      icon(ICONS.search),
      this.filter,
      h('span', { class: 'sb-find-hint', 'aria-hidden': 'true' }, 'Ctrl+K')
    )
  }

  /** The command (Ctrl+Shift+O) lands here; a collapsed rail opens first so the field has somewhere to be. */
  private readonly onFilterRequest = (): void => {
    if (this.lastState && isSidebarCollapsed(this.lastState)) toggleSidebar()
    this.focusFilterNext = true
    this.signature = ''
    this.render(this.lastState, this.lastViews)
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

  private zoneGroups(state: AppState, zones: SidebarZones<SidebarEntry<PaneView>>, filtering: boolean, listedAbove: ReadonlySet<string>): HTMLElement[] {
    const group = (entry: SidebarEntry<PaneView>, zone: ProjectZone): HTMLElement =>
      h('div', { class: `proj-group zone-${zone}${zone === 'active' ? ' card' : ''}`, 'data-zone': zone }, ...this.projectRows(state, entry, filtering, zone, listedAbove))
    return [...zones.active.map((entry) => group(entry, zones.grouped ? 'active' : 'all')), ...zones.pinned.map((entry) => group(entry, 'pinned')), ...zones.quiet.map((entry) => group(entry, 'quiet'))]
  }

  private toggleQuiet(projectId: string): void {
    if (!this.quietOpen.delete(projectId)) this.quietOpen.add(projectId)
    this.focusAfterRender(`p:${projectId}`)
    this.signature = ''
    this.render(this.lastState, this.lastViews)
  }

  // A project whose folder is gone keeps its row and place in the list, with Locate to point it at the moved folder.
  private projectRows(state: AppState, entry: SidebarEntry<PaneView>, filtering: boolean, zone: ProjectZone, listedAbove: ReadonlySet<string>): HTMLElement[] {
    const rows = this.projectRowsBody(state, entry, filtering, zone, listedAbove)
    if (!state.missingProjects.includes(entry.project.id)) return rows
    const project = entry.project
    rows[0].classList.add('proj-missing')
    const locate = h('button', { class: 'btn small', type: 'button', 'aria-label': `Locate the folder for ${project.name}`, onClick: () => void locateProject(project.id) }, 'Locate…')
    return [rows[0], h('div', { class: 'proj-missing-line' }, icon(ICONS.folder), h('span', { class: 'proj-missing-text' }, 'Folder not found'), locate), ...rows.slice(1)]
  }

  private projectRowsBody(state: AppState, { project, views: own, closed }: SidebarEntry<PaneView>, filtering: boolean, zone: ProjectZone, listedAbove: ReadonlySet<string>): HTMLElement[] {
    const quiet = zone === 'quiet'
    const compact = quiet && !this.quietOpen.has(project.id)
    const collapsed = quiet ? compact : isFolded(state.settings.foldedProjects, project.id, filtering)
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
      icon(collapsed ? ICONS.chevronRight : ICONS.chevronDown),
      h('span', { class: 'proj-title' },
        h('span', { class: 'proj-name', dir: 'auto' }, project.name),
        project.pinned === true ? h('span', { class: 'proj-pin', role: 'img', 'aria-label': 'Pinned' }, icon(ICONS.pin)) : null
      )
    )
    if (compact) toggle.classList.add('quiet-toggle')
    const dots = projectDots(own.map(viewState))
    const row = h(
      'div',
      { class: `proj-row${compact ? ' quiet-row' : ''}${filtering ? '' : ' reorderable'}`, 'data-drop-project': project.id },
      toggle,
      dots ?? (own.length === 0 ? h('span', { class: 'proj-none' }, 'no sessions') : null),
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
    for (const view of own) rows.push(this.openRow(state, project, view, listedAbove.has(view.pane.id)))
    rows.push(...this.closedLine(state, project, closed))
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

  private openRow(state: AppState, project: Project, view: PaneView, listedAbove: boolean): HTMLElement {
    const key = `s:${view.pane.id}`
    const selected = view.pane.id === state.focusedId
    const facts = this.facts.get(view.pane.id) ?? rowFacts(state, view)
    const main = this.edit?.key === key
      ? this.renameField(key, view.title, view.agent, selected)
      : sessionRowButton(view, facts, { key, selected, dimmed: listedAbove, onClick: () => focusPane(view.pane.id) })
    return h('div', { class: `kept-session-row${selected ? ' selected' : ''}${listedAbove ? ' dimmed' : ''}` },
      main,
      this.sessionMenuButton(key, view.title, project, view.tagAuto ? null : view.tag, (tag) => tagSession(view.pane.id, tag), 'Close', () => void closePane(view.pane.id)),
      iconButton(`Close ${view.title} in ${project.name}`, ICONS.close, () => void closePane(view.pane.id), 'small sess-close')
    )
  }

  /** Closed sessions fold into one line per project that opens the Resume picker for it. */
  private closedLine(state: AppState, project: Project, closed: KeptSession[]): HTMLElement[] {
    const summary = closedSummary(closed.map((session) => session.closedAt), state.now)
    if (summary === '') return []
    return [h('button', { class: 'closed-line', type: 'button', 'aria-label': `${summary}. Open Resume for ${project.name}`, title: `Resume a closed session in ${project.name}`, 'data-nav': `ct:${project.id}`, onClick: () => openResumePicker(project.id) }, summary)]
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
    return kind === 's' ? (this.lastViews.find((view) => view.pane.id === rest[0])?.title ?? null) : null
  }

  private finishRename(raw: string, key: string, save: boolean): void {
    if (this.edit?.key !== key) return
    this.edit = null
    const name = cleanSessionName(raw)
    this.focusAfterRender(key)
    if (save && name && name !== this.currentTitle(key)) {
      const [kind, ...rest] = key.split(':')
      if (kind === 's') renameSession(rest[0], name)
    }
    this.signature = ''
    this.render(this.lastState, this.lastViews)
  }

  private waitingGroup(state: AppState, views: PaneView[]): { rows: HTMLElement[]; ids: ReadonlySet<string> } {
    const waiting = waitingOnYou(views.map((view) => ({ view, state: viewState(view), at: viewActivity(view) })))
    if (waiting.length === 0) return { rows: [], ids: new Set() }
    const rows = waiting.map(({ view }) => {
      const project = state.settings.projects.find((p) => p.id === view.pane.projectId)
      const selected = view.pane.id === state.focusedId
      const facts = this.facts.get(view.pane.id) ?? rowFacts(state, view)
      return h('div', { class: `kept-session-row waiting-row${selected ? ' selected' : ''}` }, waitingRowButton(view, facts, project?.name ?? null, selected, () => focusPane(view.pane.id)))
    })
    const head = h('div', { class: 'side-sec needs' }, h('span', { class: 'side-sec-label' }, 'Needs you'), h('span', { class: 'side-sec-count' }, String(waiting.length)))
    return { rows: [h('section', { class: 'needs-group', 'aria-label': 'Needs you' }, head, ...rows)], ids: new Set(waiting.map(({ view }) => view.pane.id)) }
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
      item(this.lastState?.settings.spendLimits?.[projectId] ? 'Change spending limit…' : 'Set spending limit…', () => void editSpendLimit(projectId)),
      item('Clean up worktrees…', () => void openWorktreeCleanup(projectId)),
      item('Checks after each reply…', () => void editTurnChecks(projectId)),
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
