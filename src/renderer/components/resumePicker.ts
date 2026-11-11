import { AGENTS, AGENT_NAMES, agentLabel } from '../../shared/agents'
import { groupSessions, messageWord, sessionFacts, sessionSummary } from '../../shared/resumeIndex'
import { formatAge } from '../../shared/statusLine'
import type { AgentKind, KeptSession, ResumeQuery, ResumeSession } from '../../shared/types'
import { primaryModifierPressed } from '../../shared/shortcuts'
import { clearClosedSessions, closeQuickPick, findOpenSession, openQuickPick, openSessionKeys, renameKeptSession, reopenKeptSessions, resumeInFocusedPane, resumeInNewPane, setQuickPickMode, tagKeptSession } from '../actions'
import { confirmRemoveClosed } from '../closedActions'
import { closedFor, closedTitle, reopenAllLabel, reopenTargets } from '../../shared/resumeClosed'
import { closedSessionsFor, closedUsageShort } from '../../shared/keptSessions'
import { api } from '../api'
import { clear, h, icon, iconButton, leave } from '../dom'
import { openContextMenu } from './contextMenu'
import { closedMenuEntries, renameField } from './resumeClosedUi'
import { sidebarTagWord } from './sessionTagUi'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { keycaps } from './keycaps'
import { modeTabs } from './pickerTabs'
import type { AppState } from '../state'
import { popupDismissButton } from './popupDismiss'
import { selectMenu, syncSelectMenu } from './selectMenu'
import { isAutomaticSession } from '../../shared/sessionText'
import './resumePicker.css'

const SEARCH_DELAY_MS = 120
const CACHE_LIMIT = 24
const cache = new Map<string, ResumeSession[]>()

function remember(key: string, sessions: ResumeSession[]): void {
  cache.delete(key)
  cache.set(key, sessions)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

function age(session: ResumeSession): string {
  const ms = Date.now() - session.modifiedAt
  return ms < 60_000 ? 'just now' : `${formatAge(ms)} ago`
}

export class ResumePickerComponent {
  private root: HTMLElement | null = null
  private search: HTMLInputElement | null = null
  private projectSelect: HTMLSelectElement | null = null
  private allProjects: HTMLInputElement | null = null
  private showAutomatic: HTMLInputElement | null = null
  private loaded: ResumeSession[] = []
  private chips: HTMLElement | null = null
  private list: HTMLElement | null = null
  private preview: HTMLElement | null = null
  private foot: HTMLElement | null = null
  private sessions: ResumeSession[] = []
  private selectedId = ''
  private agent: AgentKind | null = null
  private loading = false
  private token = 0
  private timer: number | undefined
  private latest: AppState | null = null
  private renamingKey = ''

  constructor(private readonly anchor: () => HTMLElement) {}

  update(state: AppState): void {
    const changed = this.latest?.settings.keptSessions !== state.settings.keptSessions || this.latest?.panes !== state.panes
    this.latest = state
    const wanted = state.quickPickOpen && state.quickPickMode === 'resume'
    if (wanted && !this.root) this.open(state)
    if (!wanted && this.root) this.close(state.quickPickOpen)
    else if (wanted && this.root && changed) this.renderAll()
  }

  private open(state: AppState): void {
    this.agent = null
    this.sessions = []
    this.selectedId = ''
    this.search = h('input', {
      class: 'text-input rp-search',
      id: 'rp-search',
      type: 'text',
      placeholder: 'Search sessions',
      'aria-label': 'Search sessions',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'rp-list',
      autocomplete: 'off'
    })
    this.projectSelect = h('select', { class: 'rp-project', id: 'rp-project', 'aria-label': 'Project filter' })
    this.projectSelect.append(h('option', { value: '' }, 'Choose project'))
    for (const project of state.settings.projects) {
      this.projectSelect.append(h('option', { value: project.id }, project.name))
    }
    const focused = state.panes.find((pane) => pane.id === state.focusedId)?.projectId
    const scope = state.resumeProjectId ?? focused
    this.projectSelect.value = scope ?? ''
    this.allProjects = h('input', { type: 'checkbox', id: 'rp-all-projects', checked: !scope })
    this.showAutomatic = h('input', { type: 'checkbox', id: 'rp-show-automatic', checked: false })
    this.projectSelect.disabled = this.allProjects.checked
    syncSelectMenu(this.projectSelect)
    this.chips = h('div', { class: 'rp-chips', role: 'group', 'aria-label': 'Agent filter' })
    this.list = h('div', { class: 'rp-list', id: 'rp-list', role: 'listbox', 'aria-label': 'Recent sessions' })
    this.preview = h('div', { class: 'rp-preview', 'aria-live': 'polite' })
    this.foot = h('div', { class: 'rp-foot' })
    const hint = h('span', { class: 'rp-hint' }, 'Tab switches agent · ', keycaps(navigator.platform.toLowerCase().includes('mac') ? 'Cmd+R' : 'Ctrl+R'), ' toggles New/Resume')
    this.root = h(
      'div',
      { class: 'popover quickpick resume-picker', role: 'dialog', 'aria-label': 'Start or resume a session' },
      h('div', { class: 'rp-head' }, h('div', { class: 'rp-top' }, modeTabs('resume'), h('span', { class: 'spacer' }), hint, popupDismissButton(() => closeQuickPick())),
        h('div', { class: 'rp-filters' }, h('div', { class: 'rp-search-wrap' }, icon(ICONS.search), this.search), selectMenu(this.projectSelect)),
        h('div', { class: 'rp-subfilters' }, this.chips, h('span', { class: 'spacer' }),
          h('label', { class: 'rp-scope', for: 'rp-all-projects' }, this.allProjects, 'All projects'),
          h('label', { class: 'rp-scope', for: 'rp-show-automatic', title: 'Sessions other tools started, such as automatic summaries and safety reviews' }, this.showAutomatic, 'Automatic sessions'))),
      h('div', { class: 'rp-body' }, this.list, this.preview),
      this.foot
    )
    this.search.addEventListener('input', () => {
      window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.load(), SEARCH_DELAY_MS)
    })
    this.projectSelect.addEventListener('change', () => this.load())
    this.allProjects.addEventListener('change', () => {
      if (this.projectSelect) {
        this.projectSelect.disabled = this.allProjects?.checked ?? false
        if (!this.allProjects?.checked && !this.projectSelect.value) this.projectSelect.value = state.settings.projects[0]?.id ?? ''
        syncSelectMenu(this.projectSelect)
      }
      this.load()
    })
    this.showAutomatic.addEventListener('change', () => {
      this.sessions = this.visible(this.loaded)
      this.renderAll()
    })
    this.root.addEventListener('keydown', (event) => this.onKey(event))
    document.body.appendChild(this.root)
    document.addEventListener('pointerdown', this.outside, true)
    this.renderChips()
    this.load()
    this.search.focus()
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as HTMLElement
    if (target.closest?.('.overlay, .select-menu-popover, .ctx-menu, .toast')) return
    if (this.root && !this.root.contains(target) && !this.anchor().contains(target)) closeQuickPick()
  }

  private close(stillOpen: boolean): void {
    window.clearTimeout(this.timer)
    this.token += 1
    document.removeEventListener('pointerdown', this.outside, true)
    leave(this.root)
    this.root = null
    this.search = null
    this.allProjects = null
    this.showAutomatic = null
    this.list = null
    this.preview = null
    if (!stillOpen) this.anchor().focus()
  }

  private currentQuery(): ResumeQuery {
    return {
      projectId: this.allProjects?.checked ? undefined : (this.projectSelect?.value || undefined),
      agent: this.agent ?? undefined,
      query: this.search?.value.trim() || undefined,
      searchContent: true
    }
  }

  private visible(sessions: ResumeSession[]): ResumeSession[] {
    return this.showAutomatic?.checked ? sessions : sessions.filter((session) => !isAutomaticSession(session.firstPrompt))
  }

  private load(): void {
    const query = this.currentQuery()
    const key = JSON.stringify(query)
    const cached = cache.get(key)
    if (cached) {
      this.loaded = cached
      this.sessions = this.visible(cached)
    }
    this.loading = !cached
    const token = ++this.token
    this.renderAll()
    api.listAllResumable(query).then(
      (sessions) => {
        if (token !== this.token || !this.root) return
        remember(key, sessions)
        this.loaded = sessions
        this.sessions = this.visible(sessions)
        this.loading = false
        this.renderAll()
      },
      () => {
        if (token !== this.token || !this.root) return
        this.loading = false
        this.renderAll()
      }
    )
  }

  private ordered(): ResumeSession[] {
    return groupSessions(this.sessions, Date.now()).flatMap((group) => group.sessions)
  }

  private choose(session: ResumeSession | undefined, here: boolean): void {
    if (!session) return
    void (here ? resumeInFocusedPane(session) : resumeInNewPane(session))
  }

  private onKey(event: KeyboardEvent): void {
    if ((event.target as HTMLElement).closest('.popup-x') && event.key !== 'Escape') return
    if ((event.target as HTMLElement).closest('.rp-rename')) return
    if (this.onClosedKey(event)) return
    const onSelect = (event.target as HTMLElement).closest('.select-menu') !== null
    const ordered = this.ordered()
    const index = ordered.findIndex((s) => `${s.agent}:${s.id}` === this.selectedId)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeQuickPick()
    } else if (primaryModifierPressed(event) && !event.shiftKey && event.key.toLowerCase() === 'r') {
      event.preventDefault()
      event.stopPropagation()
      setQuickPickMode('new')
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !onSelect) {
      event.preventDefault()
      if (ordered.length === 0) return
      const next = (Math.max(0, index) + (event.key === 'ArrowDown' ? 1 : -1) + ordered.length) % ordered.length
      this.selectedId = `${ordered[next].agent}:${ordered[next].id}`
      this.renderList()
      this.renderPreview()
      this.list?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' && !onSelect) {
      event.preventDefault()
      this.choose(ordered[Math.max(0, index)], event.shiftKey)
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      const order: (AgentKind | null)[] = [null, ...AGENTS]
      this.agent = order[(order.indexOf(this.agent) + 1) % order.length]
      this.load()
    }
  }

  private selectedSession(): ResumeSession | undefined {
    return this.sessions.find((s) => `${s.agent}:${s.id}` === this.selectedId)
  }

  private keptFor(session: ResumeSession): KeptSession | undefined {
    return this.latest ? closedFor(session, this.latest.settings.keptSessions, openSessionKeys(this.latest)) : undefined
  }

  /** F2 renames, Delete removes and the menu key opens the actions for the selected closed session. */
  private onClosedKey(event: KeyboardEvent): boolean {
    const session = this.selectedSession()
    const kept = session ? this.keptFor(session) : undefined
    if (!session || !kept) return false
    const atEnd = !this.search?.value || this.search.selectionStart === this.search.value.length
    if (event.key === 'F2') this.startRename(session)
    else if (event.key === 'Delete' && (event.target !== this.search || atEnd)) void this.removeClosed(kept)
    else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const rect = this.list?.querySelector('.rp-row.selected')?.getBoundingClientRect()
      this.openRowMenu(session, kept, { x: (rect?.left ?? 0) + 40, y: rect?.bottom ?? 0 })
    } else return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  private startRename(session: ResumeSession): void {
    this.renamingKey = `${session.agent}:${session.id}`
    this.selectedId = this.renamingKey
    this.renderList(true)
    const input = this.list?.querySelector<HTMLInputElement>('.rp-rename')
    input?.focus()
    input?.select()
  }

  private finishRename(session: ResumeSession, name: string | null): void {
    this.renamingKey = ''
    if (name !== null) renameKeptSession(session.agent, session.id, name)
    this.renderAll()
    this.search?.focus()
  }

  private async removeClosed(kept: KeptSession): Promise<void> {
    const project = this.latest?.settings.projects.find((p) => p.id === kept.projectId)
    await confirmRemoveClosed(kept, project)
    this.search?.focus()
  }

  private async clearClosed(projectId: string): Promise<void> {
    await clearClosedSessions(projectId)
    this.search?.focus()
  }

  private openRowMenu(session: ResumeSession, kept: KeptSession, at: { x: number; y: number }, anchor?: DOMRect): void {
    openContextMenu({
      ...at,
      anchor,
      label: `Actions for ${closedTitle(session, kept)}`,
      returnFocus: this.search,
      entries: closedMenuEntries(kept, {
        rename: () => this.startRename(session),
        tag: (tag) => tagKeptSession(session.agent, session.id, tag),
        remove: () => void this.removeClosed(kept)
      })
    })
  }

  private renderAll(): void {
    this.renderChips()
    this.renderList()
    this.renderPreview()
    this.renderFoot()
  }

  private renderChips(): void {
    if (!this.chips) return
    const chip = (agent: AgentKind | null): HTMLElement =>
      h(
        'button',
        {
          class: `rp-chip${this.agent === agent ? ' selected' : ''}`,
          type: 'button',
          'aria-pressed': String(this.agent === agent),
          'data-agent': agent ?? 'all',
          onClick: () => {
            this.agent = agent
            this.load()
            this.search?.focus()
          }
        },
        agent ? agentMark(agent) : null,
        agent ? AGENT_NAMES[agent] : 'All'
      )
    this.chips.replaceChildren(chip(null), ...AGENTS.map((agent) => chip(agent)))
  }

  private renderList(force = false): void {
    if (!this.list || !this.search) return
    if (this.renamingKey && !force) return
    const list = this.list
    clear(list)
    const ordered = this.ordered()
    if (!ordered.some((s) => `${s.agent}:${s.id}` === this.selectedId)) {
      this.selectedId = ordered[0] ? `${ordered[0].agent}:${ordered[0].id}` : ''
    }
    if (ordered.length === 0) {
      list.append(this.emptyState())
      this.search.removeAttribute('aria-activedescendant')
      return
    }
    for (const group of groupSessions(this.sessions, Date.now())) {
      list.append(this.groupHeader(group.label, group.sessions))
      for (const session of group.sessions) list.append(this.row(session))
    }
    this.search.setAttribute('aria-activedescendant', `rp-${this.selectedId}`)
  }

  private groupHeader(label: string, sessions: ResumeSession[]): HTMLElement {
    const state = this.latest
    const target = state ? reopenTargets(sessions, state.settings.keptSessions, openSessionKeys(state)) : null
    const project = state?.settings.projects.find((p) => p.id === target?.projectId)
    if (!target || !project) return h('div', { class: 'rp-group', role: 'presentation' }, label)
    const reopen = h('button', {
      class: 'link rp-reopen', type: 'button', tabindex: '-1',
      'aria-label': reopenAllLabel(target.sessions.length, label, project.name),
      onClick: () => void reopenKeptSessions(project, target.sessions, label)
    }, 'Reopen all')
    return h('div', { class: 'rp-group', role: 'presentation' }, h('span', {}, label), reopen)
  }

  private emptyState(): HTMLElement {
    if (this.loading) return h('p', { class: 'popover-empty' }, 'Loading sessions…')
    const projectName = this.allProjects?.checked ? undefined : this.latest?.settings.projects.find((p) => p.id === this.projectSelect?.value)?.name
    const filtered = Boolean(this.search?.value.trim()) || this.agent !== null
    const text = filtered ? 'No sessions match.' : projectName ? `No earlier sessions in ${projectName}.` : 'No earlier sessions found.'
    return h(
      'div',
      { class: 'rp-empty' },
      h('p', { class: 'popover-empty' }, text, filtered ? null : ' Start one with New.'),
      filtered
        ? null
        : h('button', { class: 'btn ghost small', type: 'button', id: 'rp-new', onClick: () => openQuickPick() }, 'New session')
    )
  }

  private row(session: ResumeSession): HTMLElement {
    const key = `${session.agent}:${session.id}`
    const selected = key === this.selectedId
    const project = this.latest?.settings.projects.find((p) => p.id === session.projectId)
    const open = this.latest ? findOpenSession(this.latest, session.agent, session.id) : null
    const kept = this.keptFor(session)
    const title = closedTitle(session, kept)
    const used = kept && this.latest ? closedUsageShort(this.latest.usage.sessions[session.id]) : null
    const row = h(
      'div',
      {
        class: `rp-row${selected ? ' selected' : ''}`,
        role: 'option',
        id: `rp-${key}`,
        'aria-selected': String(selected),
        'data-session-id': session.id
      },
      agentMark(session.agent),
      h(
        'div',
        { class: 'rp-row-main' },
        h('div', { class: 'rp-row-title' }, this.renamingKey === key
          ? renameField(title, (name) => this.finishRename(session, name))
          : h('span', { class: 'rp-title', dir: 'auto' }, title),
          h('span', { class: 'rp-age' }, age(session)),
          kept ? this.moreButton(session, kept, title) : null),
        h(
          'div',
          { class: 'rp-row-meta' },
          this.allProjects?.checked && project ? h('span', { class: 'rp-project-chip' }, project.name) : null,
          h('span', {}, messageWord(session.messageCount)),
          session.matchExcerpt ? h('span', { class: 'rp-match-chip' }, 'content match') : null,
          kept?.tag ? sidebarTagWord(kept.tag) : null,
          used ? h('span', {}, used) : null,
          open ? h('span', { class: 'rp-open' }, `open in pane ${open.number}`) : null
        )
      )
    )
    row.addEventListener('contextmenu', (event) => {
      if (!kept) return
      event.preventDefault()
      this.selectedId = key
      this.openRowMenu(session, kept, { x: event.clientX, y: event.clientY })
    })
    row.addEventListener('mousemove', () => {
      if (this.selectedId === key || this.renamingKey) return
      this.selectedId = key
      this.renderList()
      this.renderPreview()
    })
    row.addEventListener('click', () => this.choose(session, false))
    return row
  }

  private moreButton(session: ResumeSession, kept: KeptSession, title: string): HTMLElement {
    const button = iconButton(`Actions for ${title}`, ICONS.more, () => {
      this.selectedId = `${session.agent}:${session.id}`
      this.openRowMenu(session, kept, { x: 0, y: 0 }, button.getBoundingClientRect())
    }, 'small rp-more')
    button.setAttribute('aria-haspopup', 'menu')
    button.tabIndex = -1
    button.addEventListener('click', (event) => event.stopPropagation())
    return button
  }

  private renderPreview(): void {
    if (!this.preview) return
    const session = this.sessions.find((s) => `${s.agent}:${s.id}` === this.selectedId)
    if (!session) {
      this.preview.replaceChildren()
      return
    }
    const project = this.latest?.settings.projects.find((p) => p.id === session.projectId)
    const field = (label: string, value: string | undefined, lines: number, extra = ''): HTMLElement | null =>
      value
        ? h('section', { class: `rp-field${extra}` }, h('h3', {}, label), h('p', { dir: 'auto', style: `-webkit-line-clamp: ${lines}` }, value))
        : null
    const facts = sessionFacts(session, Date.now())
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'rp-pv-head' }, agentMark(session.agent), h('h2', { class: 'rp-pv-title', dir: 'auto' }, session.title)),
      h('p', { class: 'rp-pv-sub' }, [agentLabel(session.agent), session.model].filter(Boolean).join(' · ')),
      project ? h('p', { class: 'rp-pv-sub' }, project.name) : null,
      project ? h('p', { class: 'rp-pv-path', title: project.folder }, project.folder) : null,
      h('p', { class: 'rp-facts', 'aria-label': 'Session facts' }, facts.join(' · ')),
      field('What it was about', session.firstPrompt, 5),
      field('Where it ended', session.lastAssistant, 7),
      field('Matching content', session.matchExcerpt, 4, ' rp-match'),
      h(
        'div',
        { class: 'rp-actions' },
        h(
          'button',
          { class: 'btn primary', type: 'button', id: 'rp-new-pane', onClick: () => this.choose(session, false) },
          'Resume in new pane',
          h('span', { class: 'btn-hint' }, 'Enter')
        ),
        h(
          'button',
          { class: 'btn ghost', type: 'button', id: 'rp-this-pane', onClick: () => this.choose(session, true) },
          'Resume in this pane',
          h('span', { class: 'btn-hint' }, 'Shift+Enter')
        )
      )
    ]
    this.preview.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null))
  }

  private renderFoot(): void {
    if (!this.foot) return
    const projects = new Set(this.sessions.map((s) => s.projectId)).size
    const projectId = this.allProjects?.checked ? '' : (this.projectSelect?.value ?? '')
    const state = this.latest
    const closed = state && projectId ? closedSessionsFor(state.settings.keptSessions, projectId, openSessionKeys(state)).length : 0
    const name = state?.settings.projects.find((p) => p.id === projectId)?.name ?? ''
    this.foot.replaceChildren(
      h('span', { class: 'rp-count' }, this.sessions.length > 0 ? sessionSummary(this.sessions.length, projects) : ''),
      closed > 0
        ? h('button', { class: 'link rp-clear', type: 'button', id: 'rp-clear-closed', onClick: () => void this.clearClosed(projectId) }, `Clear ${closed} closed in ${name}`)
        : '',
      h('span', { class: 'spacer' }),
      h('span', {}, '↑ ↓ move · Esc closes')
    )
  }
}
