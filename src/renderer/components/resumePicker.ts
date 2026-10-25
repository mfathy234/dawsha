import { AGENTS, AGENT_NAMES, agentLabel } from '../../shared/agents'
import { groupSessions, messageWord, sessionSummary } from '../../shared/resumeIndex'
import { formatAge } from '../../shared/statusLine'
import { ageGroup } from '../../shared/resumeIndex'
import type { AgentKind, ResumeQuery, ResumeSession } from '../../shared/types'
import { primaryModifierPressed } from '../../shared/shortcuts'
import { closeQuickPick, findOpenSession, openQuickPick, resumeInFocusedPane, resumeInNewPane, setQuickPickMode } from '../actions'
import { api } from '../api'
import { clear, h, icon } from '../dom'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { modeTabs } from './pickerTabs'
import type { AppState } from '../state'
import { popupDismissButton } from './popupDismiss'

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

function whenText(time: number): string {
  const clock = new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const group = ageGroup(time, Date.now())
  if (group === 'Today' || group === 'Yesterday') return `${group}, ${clock}`
  return `${new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}, ${clock}`
}

export class ResumePickerComponent {
  private root: HTMLElement | null = null
  private search: HTMLInputElement | null = null
  private projectSelect: HTMLSelectElement | null = null
  private allProjects: HTMLInputElement | null = null
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

  constructor(private readonly anchor: () => HTMLElement) {}

  update(state: AppState): void {
    this.latest = state
    const wanted = state.quickPickOpen && state.quickPickMode === 'resume'
    if (wanted && !this.root) this.open(state)
    if (!wanted && this.root) this.close(state.quickPickOpen)
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
    this.projectSelect.disabled = this.allProjects.checked
    this.chips = h('div', { class: 'rp-chips', role: 'group', 'aria-label': 'Agent filter' })
    this.list = h('div', { class: 'rp-list', id: 'rp-list', role: 'listbox', 'aria-label': 'Recent sessions' })
    this.preview = h('div', { class: 'rp-preview', 'aria-live': 'polite' })
    this.foot = h('div', { class: 'rp-foot' })
    const hint = h(
      'span',
      { class: 'rp-hint' },
      h('span', { class: 'kbd' }, 'Tab'),
      ' switches agent · ',
      h('span', { class: 'kbd' }, navigator.platform.toLowerCase().includes('mac') ? 'Cmd+R' : 'Ctrl+R'),
      ' toggles New/Resume'
    )
    this.root = h(
      'div',
      { class: 'popover quickpick resume-picker', role: 'dialog', 'aria-label': 'Start or resume a session' },
      h('div', { class: 'rp-head' }, h('div', { class: 'rp-top' }, modeTabs('resume'), h('span', { class: 'spacer' }), hint, popupDismissButton(() => closeQuickPick())),
        h('div', { class: 'rp-filters' }, h('div', { class: 'rp-search-wrap' }, icon(ICONS.search), this.search), this.projectSelect,
          h('label', { class: 'rp-scope', for: 'rp-all-projects' }, this.allProjects, 'Search all projects')),
        this.chips),
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
      }
      this.load()
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
    if (target.closest?.('.overlay')) return
    if (this.root && !this.root.contains(target) && !this.anchor().contains(target)) closeQuickPick()
  }

  private close(stillOpen: boolean): void {
    window.clearTimeout(this.timer)
    this.token += 1
    document.removeEventListener('pointerdown', this.outside, true)
    this.root?.remove()
    this.root = null
    this.search = null
    this.allProjects = null
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

  private load(): void {
    const query = this.currentQuery()
    const key = JSON.stringify(query)
    const cached = cache.get(key)
    if (cached) this.sessions = cached
    this.loading = !cached
    const token = ++this.token
    this.renderAll()
    api.listAllResumable(query).then(
      (sessions) => {
        if (token !== this.token || !this.root) return
        remember(key, sessions)
        this.sessions = sessions
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
    const onSelect = (event.target as HTMLElement).tagName === 'SELECT'
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

  private renderList(): void {
    if (!this.list || !this.search) return
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
      list.append(h('div', { class: 'rp-group', role: 'presentation' }, group.label))
      for (const session of group.sessions) list.append(this.row(session))
    }
    this.search.setAttribute('aria-activedescendant', `rp-${this.selectedId}`)
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
        h('div', { class: 'rp-row-title' }, h('span', { class: 'rp-title' }, session.title), h('span', { class: 'rp-age' }, age(session))),
        h(
          'div',
          { class: 'rp-row-meta' },
          h('span', { class: 'rp-project-chip' }, project?.name ?? ''),
          h('span', {}, messageWord(session.messageCount)),
          session.matchExcerpt ? h('span', { class: 'rp-match-chip' }, 'content match') : null,
          open ? h('span', { class: 'rp-open' }, `open in pane ${open.number}`) : null
        )
      )
    )
    row.addEventListener('mousemove', () => {
      if (this.selectedId === key) return
      this.selectedId = key
      this.renderList()
      this.renderPreview()
    })
    row.addEventListener('click', () => this.choose(session, false))
    return row
  }

  private renderPreview(): void {
    if (!this.preview) return
    const session = this.sessions.find((s) => `${s.agent}:${s.id}` === this.selectedId)
    if (!session) {
      this.preview.replaceChildren()
      return
    }
    const project = this.latest?.settings.projects.find((p) => p.id === session.projectId)
    const field = (label: string, value: string | undefined, clamp = false): HTMLElement | null =>
      value ? h('section', { class: 'rp-field' }, h('h3', {}, label), h('p', { class: clamp ? 'clamp' : '' }, value)) : null
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'rp-pv-head' }, agentMark(session.agent), h('h2', { class: 'rp-pv-title' }, session.title)),
      h('p', { class: 'rp-pv-sub' }, [agentLabel(session.agent), session.model].filter(Boolean).join(' · ')),
      h('p', { class: 'rp-pv-sub' }, project?.name ?? '', project ? ' ' : '', h('span', { class: 'mono' }, project?.folder ?? '')),
      h(
        'dl',
        { class: 'rp-times' },
        h('dt', {}, 'Started'),
        h('dd', {}, whenText(session.startedAt)),
        h('dt', {}, 'Last active'),
        h('dd', {}, age(session))
      ),
      field('First prompt', session.firstPrompt, true),
      field('Last assistant message', session.lastAssistant, true),
      field('Matching content', session.matchExcerpt, true),
      h(
        'div',
        { class: 'rp-actions' },
        h(
          'button',
          { class: 'btn primary', type: 'button', id: 'rp-new-pane', onClick: () => this.choose(session, false) },
          'Resume in new pane ',
          h('span', { class: 'kbd' }, 'Enter')
        ),
        h(
          'button',
          { class: 'btn ghost', type: 'button', id: 'rp-this-pane', onClick: () => this.choose(session, true) },
          'Resume in this pane ',
          h('span', { class: 'kbd' }, 'Shift+Enter')
        )
      )
    ]
    this.preview.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null))
  }

  private renderFoot(): void {
    if (!this.foot) return
    const projects = new Set(this.sessions.map((s) => s.projectId)).size
    this.foot.replaceChildren(
      h('span', { class: 'rp-count' }, this.sessions.length > 0 ? sessionSummary(this.sessions.length, projects) : ''),
      h('span', { class: 'spacer' }),
      h('span', {}, 'Up Down move · Esc closes')
    )
  }
}
