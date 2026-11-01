import {
  focusNextAttention,
  focusPane,
  openQuickPick,
  openSettings,
  openResumePicker,
  showView,
  toggleLayouts,
  toggleThemePicker,
  toggleUpdatePopover,
  openPalette
} from '../actions'
import { pillLabel, showUpdatePill } from '../../shared/updates'
import { AGENTS, AGENT_NAMES, agentLabel } from '../../shared/agents'
import type { AgentKind } from '../../shared/types'
import { openCompareDialog } from '../compareActions'
import { ICONS } from '../icons'
import faviconSvg from '../../../site/favicon.svg?raw'
import { agentMark } from './agentMark'
import type { PaneView } from '../derive'
import { countSessionStates, sessionState } from '../../shared/sessionState'
import { MORE_VIEWS, countsLine, formatResetIn, limitRowLabel, type MoreView } from '../../shared/topbarSummary'
import { api } from '../api'
import type { AgentAccount, AgentAccounts } from '../../shared/agentAccounts'
import { allAgentLimits, dataAge, meterLimits, recordLimits, type AgentLimitStore, type AgentLimits } from '../../shared/agentLimits'
import { stateIcon } from './stateIcon'
import { toolState } from '../../shared/agentTools'
import { formatPercent } from '../../shared/statusLine'
import { visibleLimitAgents } from '../../shared/visibleAgents'
import { limitsPillModel, type LimitsPillModel } from '../../shared/limitsPill'
import { checkLimitWarnings } from '../limitNotices'
import { limitsPillChildren } from './limitRings'
import { ViewMenu } from './viewMenu'
import { chargeBar } from './chargeBar'
import type { TabAgent } from '../../shared/types'
import { h, icon, leave, placeNearAnchor } from '../dom'
import { store, type AppState } from '../state'
import { bind, formatShortcut } from '../../shared/shortcuts'
import { NotificationBell } from './notificationBell'
import { AVATAR_LABELS, compareAvatarStates, stripSummary, type AvatarState } from '../../shared/crewLive'
import { acknowledgeRun, liveRuns } from '../crewLive'
import { crewAvatar } from './crewAvatar'
import { openHandDialog } from './crewDialogs'
import './topbar.css'
import './topbarTools.css'

const LIMIT_CELLS = 5
const KNOWN_LIMITS_MS = 15_000
/** Below this width nav labels become icons and New session becomes a + button. Keep in step with topbar-narrow.css. */
const NARROW_QUERY = '(max-width: 1099px)'

const NEEDS_KEY_HINT = formatShortcut(bind('Ctrl+Shift+J'))
const AGENTS_KEY_HINT = formatShortcut(bind('Ctrl+Shift+L'))
const FILES_KEY_HINT = formatShortcut(bind('Ctrl+Shift+E'))

export class TopBarComponent {
  readonly el: HTMLElement
  readonly newSession = h(
    'button',
    {
      class: 'split-main',
      type: 'button',
      id: 'new-session',
      'aria-haspopup': 'menu',
      'aria-label': `New session, ${formatShortcut(bind('Ctrl+N'))}`,
      'aria-expanded': 'false',
      onClick: (event: Event) => {
        if ((event.target as Element).closest('#new-session-agent')) this.toggleAgentMenu()
        else openQuickPick()
      }
    },
    h('span', { class: 'new-session-icon', 'aria-hidden': 'true' }, icon(ICONS.plus)),
    h('span', { class: 'new-session-label' }, 'New session'),
    h('span', { class: 'new-session-kbd', 'aria-hidden': 'true' }, formatShortcut(bind('Ctrl+N'))),
    h('span', { class: 'split-chevron', id: 'new-session-agent', 'aria-hidden': 'true', title: 'Choose agent' }, icon(ICONS.chevronDown))
  )
  private readonly chevron = this.newSession.querySelector<HTMLElement>('#new-session-agent')!
  private agentMenu: HTMLElement | null = null
  private readonly bell = new NotificationBell()
  private readonly search = h('button', { class: 'btn ghost topbar-tool', type: 'button', id: 'search-button', 'aria-label': 'Search', title: 'Search', onClick: () => openPalette() },
    h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon(ICONS.search)),
    h('span', { class: 'utility-label' }, 'Search')
  )
  readonly themeButton = h(
    'button',
    { class: 'btn ghost topbar-tool', type: 'button', id: 'theme-button', 'aria-label': 'Theme', title: 'Theme', 'aria-haspopup': 'dialog', onClick: () => toggleThemePicker() },
    h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon(ICONS.palette)),
    h('span', { class: 'utility-label' }, 'Theme')
  )
  private readonly sessions = navButton('sessions-button', 'Sessions', ICONS.terminal, null, () => showView('grid'))
  private readonly background = navButton('background-button', 'Agents', ICONS.navAgents, AGENTS_KEY_HINT, () => showView(this.background.getAttribute('aria-pressed') === 'true' ? 'grid' : 'crew'))
  private readonly crewStrip = h('div', { class: 'crew-strip', id: 'crew-strip', role: 'group', 'aria-label': 'Who is on a job', hidden: true })
  private crewStripSignature = ''
  private readonly files = navButton('files-button', 'Files', ICONS.folder, FILES_KEY_HINT, () => showView(this.files.getAttribute('aria-pressed') === 'true' ? 'grid' : 'files'))
  private readonly work = navButton('work-button', 'Work', ICONS.navWork, null, () => showView(this.work.getAttribute('aria-pressed') === 'true' ? 'grid' : 'work'))
  private readonly skills = navButton('skills-button', 'Skills', ICONS.navSkills, null, () => showView(this.skills.getAttribute('aria-pressed') === 'true' ? 'grid' : 'skills'))
  private readonly moreDot = h('span', { class: 'update-dot', hidden: true, title: 'Agent updates available' })
  private readonly moreText = h('span', { class: 'more-text' }, 'More')
  private readonly more = h(
    'button',
    { class: 'btn ghost more-button', type: 'button', id: 'more-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: () => this.toggleMoreMenu() },
    this.moreText,
    h('span', { class: 'more-chevron', 'aria-hidden': 'true' }, icon(ICONS.chevronDown)),
    this.moreDot
  )
  private readonly viewMenu = new ViewMenu()
  /** The Layouts popover hangs from the open View menu's Layouts item, or from the View button once the menu has closed. */
  get layoutsButton(): HTMLElement {
    return this.viewMenu.layoutsAnchor
  }
  private moreMenu: HTMLElement | null = null
  private moreItems: Record<MoreView, HTMLElement> | null = null
  private agentUpdates = false
  private activeMore: MoreView | null = null
  private readonly settings = h('button', { class: 'btn ghost topbar-tool', type: 'button', id: 'settings-button', 'aria-label': 'Settings', title: 'Settings' },
    h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon(ICONS.settings)),
    h('span', { class: 'utility-label' }, 'Settings')
  )
  private readonly needsChip = h(
    'button',
    {
      class: 'sum-chip sum-needs',
      type: 'button',
      id: 'needs-chip',
      hidden: true,
      title: `Go to the session that needs you (${NEEDS_KEY_HINT})`,
      onClick: () => {
        if (!focusNextAttention()) showView('grid')
      }
    }
  )
  private needsCount = -1
  private readonly narrowQuery = window.matchMedia(NARROW_QUERY)
  readonly updatePill = h('button', {
    class: 'update-pill',
    type: 'button',
    id: 'update-pill',
    hidden: true,
    'aria-haspopup': 'dialog',
    onClick: () => toggleUpdatePopover()
  })
  private readonly pillText = h('span', { class: 'pill-text' })
  private readonly pillLine = h('span', { class: 'pill-line' })
  private readonly limits = h('button', { class: 'topbar-limits', type: 'button', id: 'topbar-limits', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onClick: () => this.toggleLimitsPopover() })
  private limitsSignature = ''
  private limitStore: AgentLimitStore = {}
  private limitsFocused: AgentLimits | null = null
  private focusedAgent: TabAgent | null = null
  private lastLimitsArgs: { state: AppState; views: PaneView[] } | null = null
  private knownLimitsAt = 0
  private limitsNow = 0
  private limitsPopover: HTMLElement | null = null
  private accounts: AgentAccounts | null = null
  private accountsRequested = false
  private readonly limitsOutside = (event: Event): void => {
    const target = event.target as Node
    if (this.limitsPopover && !this.limitsPopover.contains(target) && !this.limits.contains(target)) this.closeLimitsPopover()
  }

  constructor() {
    this.more.classList.add('app-logo', 'app-logo-menu')
    this.more.setAttribute('aria-label', 'Dawsha menu')
    this.more.replaceChildren(icon(faviconSvg), h('span', { class: 'app-title' }, 'Dawsha'))
    this.settings.addEventListener('click', () => {
      if (this.settings.getAttribute('aria-pressed') === 'true') showView('grid')
      else openSettings()
    })
    this.el = h(
      'header',
      { class: 'topbar' },
      this.more,
      h('nav', { class: 'topbar-nav', 'aria-label': 'Main views' },
        this.sessions,
        this.background,
        this.files,
        this.work,
        this.skills
      ),
      this.viewMenu.el,
      this.needsChip,
      this.crewStrip,
      this.updatePill,
      h('span', { class: 'spacer' }),
      this.limits,
      h('div', { class: 'topbar-tools' },
        this.search,
        this.bell.el,
        this.settings
      ),
      this.newSession
    )
    this.narrowQuery.addEventListener('change', () => this.onNarrowChange())
    this.onNarrowChange()
  }

  private get narrow(): boolean {
    return this.narrowQuery.matches
  }

  private onNarrowChange(): void {
    this.newSession.setAttribute('aria-label', this.narrow ? 'New session' : `New session, ${formatShortcut(bind('Ctrl+N'))}`)
    this.limitsSignature = ''
    if (this.lastLimitsArgs) this.updateLimits(this.lastLimitsArgs.state, this.lastLimitsArgs.views)
  }

  update(state: AppState, views: PaneView[]): void {
    this.updateLimits(state, views)
    this.sessions.setAttribute('aria-pressed', String(state.view === 'grid'))
    this.background.setAttribute('aria-pressed', String(state.view === 'crew'))
    this.files.setAttribute('aria-pressed', String(state.view === 'files'))
    this.work.setAttribute('aria-pressed', String(state.view === 'work'))
    this.skills.setAttribute('aria-pressed', String(state.view === 'skills'))
    for (const [button, active] of [[this.sessions, state.view === 'grid'], [this.background, state.view === 'crew'], [this.files, state.view === 'files'], [this.work, state.view === 'work'], [this.skills, state.view === 'skills']] as const) {
      if (active) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
    this.updateCrewStrip(state)
    this.settings.setAttribute('aria-pressed', String(state.view === 'settings'))
    this.agentUpdates = state.agents.report?.tools.some((tool) => toolState(tool) === 'update') === true
    this.updateMore(state)
    this.updatePillState(state)
    this.themeButton.setAttribute('aria-expanded', String(state.themePickerOpen))
    this.updateSummary(state, views)
  }

  private updateCrewStrip(state: AppState): void {
    const byMember = new Map<string, { run: ReturnType<typeof liveRuns>[number]; states: AvatarState[] }>()
    for (const run of liveRuns(state)) {
      if (run.state === 'idle') continue
      const key = run.tab.crew!.memberId
      const known = byMember.get(key)
      if (!known) {
        byMember.set(key, { run, states: [run.state] })
      } else {
        known.states.push(run.state)
        if (compareAvatarStates(run.state, known.run.state) < 0) known.run = run
      }
    }
    const entries = [...byMember.values()].sort((a, b) => compareAvatarStates(a.run.state, b.run.state))
    const signature = JSON.stringify(entries.map((e) => [e.run.tab.crew!.runId, e.run.pane.id, e.run.state, e.states]))
    if (signature === this.crewStripSignature) return
    this.crewStripSignature = signature
    this.crewStrip.hidden = entries.length === 0
    const label = h('span', { class: 'crew-strip-label', 'data-crew-summary': '' }, stripSummary(entries.flatMap((entry) => entry.states)))
    this.crewStrip.replaceChildren(
      label,
      ...entries.map(({ run }) => {
        const identity = run.tab.crew!
        const button = h(
          'button',
          {
            class: 'crew-strip-btn',
            type: 'button',
            'data-run': identity.runId,
            'aria-label': `${identity.name}, ${AVATAR_LABELS[run.state]}. Go to its pane`,
            title: `${identity.name} · ${AVATAR_LABELS[run.state]}`
          },
          crewAvatar(identity, run.state, 24)
        )
        button.addEventListener('click', () => {
          acknowledgeRun(identity.runId, run.pane.id)
          focusPane(run.pane.id)
        })
        return button
      })
    )
  }

  private updateMore(state: AppState): void {
    this.activeMore = MORE_VIEWS.some((item) => item.view === state.view && item.view !== 'work' && item.view !== 'skills') ? (state.view as MoreView) : null
    const label = 'Dawsha menu'
    this.more.setAttribute('aria-pressed', String(this.activeMore !== null))
    this.more.setAttribute('aria-expanded', String(this.moreMenu !== null))
    this.more.setAttribute('aria-label', this.agentUpdates ? `${label}, agent updates available` : label)
    this.moreText.textContent = 'Dawsha'
    this.moreDot.hidden = !this.agentUpdates
    for (const { view } of MORE_VIEWS) this.markMoreItem(view)
  }

  private markMoreItem(view: MoreView): void {
    const item = this.moreItems?.[view]
    if (!item) return
    item.setAttribute('aria-current', String(this.activeMore === view))
    const dot = item.querySelector<HTMLElement>('.update-dot')
    if (dot) dot.hidden = !this.agentUpdates
  }

  private updateSummary(state: AppState, views: PaneView[]): void {
    const counts = countSessionStates(views.map((view) => sessionState(view)))
    this.viewMenu.update(state, countsLine(counts))
    if (counts.needs === this.needsCount) return
    this.needsCount = counts.needs
    this.needsChip.hidden = counts.needs === 0
    this.needsChip.setAttribute('aria-label', `${counts.needs} needs you, go to the next one, ${NEEDS_KEY_HINT}`)
    this.needsChip.replaceChildren(stateIcon('needs'), `${counts.needs} needs you`, h('span', { class: 'kbd', 'aria-hidden': 'true' }, NEEDS_KEY_HINT))
  }

  private updatePillState(state: AppState): void {
    const { update } = state
    const visible = showUpdatePill(update)
    this.updatePill.hidden = !visible
    if (!visible) return
    this.updatePill.className = `update-pill status-${update.status}`
    this.updatePill.setAttribute('aria-expanded', String(state.updatePopoverOpen))
    this.pillText.textContent = pillLabel(update)
    this.pillLine.style.width = update.status === 'downloading' ? `${Math.round(update.percent)}%` : '0'
    if (this.pillText.parentElement !== this.updatePill || this.pillLine.parentElement !== this.updatePill) {
      this.updatePill.replaceChildren(this.pillText, this.pillLine)
    }
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.agentMenu && !this.agentMenu.contains(target) && !this.chevron.contains(target)) this.closeAgentMenu()
  }

  private closeAgentMenu(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    leave(this.agentMenu)
    this.agentMenu = null
    this.newSession.setAttribute('aria-expanded', 'false')
  }

  private toggleAgentMenu(): void {
    if (this.agentMenu) {
      this.closeAgentMenu()
      return
    }
    const choose = (agent: AgentKind): void => {
      this.closeAgentMenu()
      openQuickPick(agent)
    }
    const items = AGENTS.map((agent) =>
      h(
        'button',
        { class: 'menu-item', type: 'button', role: 'menuitem', 'data-agent': agent, onClick: () => choose(agent) },
        agentMark(agent),
        `${AGENT_NAMES[agent]} session`
      )
    )
    const resume = h(
      'button',
      {
        class: 'menu-item menu-resume',
        type: 'button',
        role: 'menuitem',
        id: 'resume-menu-item',
        onClick: () => {
          this.closeAgentMenu()
          openResumePicker()
        }
      },
      icon(ICONS.history),
      'Resume a session…',
      h('span', { class: 'kbd' }, formatShortcut(bind('Ctrl+Shift+R')))
    )
    const compare = h(
      'button',
      {
        class: 'menu-item',
        type: 'button',
        role: 'menuitem',
        id: 'compare-menu-item',
        onClick: () => {
          this.closeAgentMenu()
          openCompareDialog()
        }
      },
      icon(ICONS.compare),
      'Ask two agents…',
      h('span', { class: 'kbd' }, formatShortcut(bind('Ctrl+Shift+A')))
    )
    const crewItem = h(
      'button',
      {
        class: 'menu-item',
        type: 'button',
        role: 'menuitem',
        id: 'crew-hand-menu-item',
        onClick: () => {
          this.closeAgentMenu()
          openHandDialog()
        }
      },
      icon(ICONS.next),
      'Hand a job to an agent…'
    )
    items.push(resume, compare, crewItem)
    this.agentMenu = h(
      'div',
      { class: 'popover menu floating', role: 'menu', 'aria-label': 'Choose agent' },
      ...items
    )
    this.agentMenu.addEventListener('keydown', (event) => this.onMenuKey(event, items))
    this.newSession.setAttribute('aria-expanded', 'true')
    document.body.appendChild(this.agentMenu)
    placeNearAnchor(this.agentMenu, this.chevron.parentElement ?? this.newSession, 6)
    items[0].focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0)
  }

  private onMenuKey(event: KeyboardEvent, items: HTMLElement[]): void {
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closeAgentMenu()
      this.newSession.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(current + step + items.length) % items.length].focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1].focus()
    } else if (event.key === 'Tab') {
      // Move focus back to the anchor before the menu leaves the DOM, so Tab continues from there.
      this.newSession.focus()
      this.closeAgentMenu()
    }
  }

  private readonly moreOutside = (event: Event): void => {
    const target = event.target as Node
    if (this.moreMenu && !this.moreMenu.contains(target) && !this.more.contains(target)) this.closeMoreMenu()
  }

  private closeMoreMenu(): void {
    document.removeEventListener('pointerdown', this.moreOutside, true)
    leave(this.moreMenu)
    this.moreMenu = null
    this.moreItems = null
    this.more.setAttribute('aria-expanded', 'false')
  }

  private openMore(view: MoreView): void {
    this.closeMoreMenu()
    if (view === 'layouts') toggleLayouts()
    else showView(this.activeMore === view ? 'grid' : view)
  }

  private toggleMoreMenu(): void {
    if (this.moreMenu) {
      this.closeMoreMenu()
      return
    }
    const entries = MORE_VIEWS.filter(({ view }) => view !== 'work' && view !== 'skills' && view !== 'layouts').map(({ view, label }) => {
      const item = h(
        'button',
        { class: 'menu-item more-item', type: 'button', role: 'menuitem', id: `${view}-menu-item`, 'data-view': view, onClick: () => this.openMore(view) },
        label,
        view === 'agents' ? h('span', { class: 'update-dot', hidden: true, title: 'Agent updates available' }) : ''
      )
      return [view, item] as const
    })
    this.moreItems = Object.fromEntries(entries) as unknown as Record<MoreView, HTMLElement>
    const items = entries.map(([, item]) => item)
    for (const [view] of entries) this.markMoreItem(view)
    this.moreMenu = h(
      'div',
      { class: 'popover menu floating', role: 'menu', 'aria-label': 'More views' },
      ...items
    )
    this.moreMenu.addEventListener('keydown', (event) => this.onMoreKey(event, items))
    this.more.setAttribute('aria-expanded', 'true')
    document.body.appendChild(this.moreMenu)
    placeNearAnchor(this.moreMenu, this.more, 6)
    items[0].focus()
    setTimeout(() => document.addEventListener('pointerdown', this.moreOutside, true), 0)
  }

  private onMoreKey(event: KeyboardEvent, items: HTMLElement[]): void {
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closeMoreMenu()
      this.more.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(current + step + items.length) % items.length].focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1].focus()
    } else if (event.key === 'Tab') {
      this.more.focus()
      this.closeMoreMenu()
    }
  }

  private refreshKnownLimits(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.knownLimitsAt < KNOWN_LIMITS_MS) return
    this.knownLimitsAt = now
    void api.knownLimits().then((known) => {
      const next = recordLimits(this.limitStore, [
        ...(known.claude ? [{ agent: 'claude' as const, windows: known.claude.windows, at: known.claude.at }] : []),
        ...(known.codex ? [{ agent: 'codex' as const, windows: known.codex.windows, at: known.codex.at }] : [])
      ])
      if (next === this.limitStore || !this.lastLimitsArgs) return
      this.limitStore = next
      this.updateLimits(this.lastLimitsArgs.state, this.lastLimitsArgs.views)
    }, () => undefined)
  }

  private updateLimits(state: AppState, views: PaneView[]): void {
    this.lastLimitsArgs = { state, views }
    this.refreshKnownLimits(false)
    this.limitStore = recordLimits(
      this.limitStore,
      views.map((view) => ({ agent: view.agent, windows: view.info.limits, at: view.info.limitsAt ?? state.now }))
    )
    const focusedView = views.find((view) => view.pane.id === state.focusedId)
    this.focusedAgent = focusedView?.agent ?? null
    this.limitsFocused = meterLimits(this.limitStore, this.focusedAgent, state.now)
    this.limitsNow = state.now
    checkLimitWarnings(this.limitStore, state.now)
    const model = limitsPillModel(this.limitStore, this.focusedAgent, state.now, this.narrow, this.visibleAgents(state))
    const signature = JSON.stringify(model)
    if (signature !== this.limitsSignature) {
      this.limitsSignature = signature
      this.renderLimits(model)
    }
    if (this.limitsPopover) this.fillLimitsPopover(this.limitsPopover)
  }

  /** Agents the limits list shows: installed ones (see visibleLimitAgents), judged from the shared install report. */
  private visibleAgents(state: AppState): AgentKind[] {
    this.loadAccountsOnce()
    const withData = AGENTS.filter((agent) => (this.limitStore[agent]?.windows.length ?? 0) > 0)
    const signedIn = AGENTS.filter((agent) => (this.accounts?.[agent]?.kind ?? 'none') !== 'none')
    return visibleLimitAgents({ report: state.agents.report?.tools ?? null, withData, signedIn, focused: this.focusedAgent })
  }

  private loadAccountsOnce(): void {
    if (this.accountsRequested) return
    this.accountsRequested = true
    void api.agentAccounts().then((accounts) => {
      this.accounts = accounts
      this.limitsSignature = ''
      if (this.lastLimitsArgs) this.updateLimits(this.lastLimitsArgs.state, this.lastLimitsArgs.views)
    }, () => { this.accountsRequested = false })
  }

  private renderLimits(model: LimitsPillModel): void {
    this.limits.hidden = model.hidden
    this.limits.classList.toggle('stale', model.stale)
    this.limits.classList.toggle('compact', this.narrow)
    if (model.hidden) return
    this.limits.setAttribute('aria-label', model.ariaLabel)
    this.limits.title = model.title
    this.limits.replaceChildren(...limitsPillChildren(model))
  }

  private toggleLimitsPopover(): void {
    if (this.limitsPopover) {
      this.closeLimitsPopover(true)
      return
    }
    const popover = h('div', { class: 'popover limits-popover floating', role: 'dialog', 'aria-label': 'Limits by agent', id: 'limits-popover' })
    popover.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.closeLimitsPopover(true)
    })
    this.limitsPopover = popover
    this.refreshKnownLimits(true)
    this.fillLimitsPopover(popover)
    // Opening the popover reads again, so signing in after launch shows at once.
    void api.agentAccounts(true).then((accounts) => {
      this.accounts = accounts
      if (this.limitsPopover === popover) this.fillLimitsPopover(popover)
    }, () => undefined)
    document.body.appendChild(popover)
    placeNearAnchor(popover, this.limits, 6)
    this.limits.setAttribute('aria-expanded', 'true')
    popover.querySelector<HTMLElement>('.limits-usage-link')?.focus()
    setTimeout(() => {
      if (this.limitsPopover === popover) document.addEventListener('pointerdown', this.limitsOutside, true)
    }, 0)
  }

  private closeLimitsPopover(returnFocus = false): void {
    document.removeEventListener('pointerdown', this.limitsOutside, true)
    leave(this.limitsPopover)
    this.limitsPopover = null
    this.limits.setAttribute('aria-expanded', 'false')
    if (returnFocus) this.limits.focus()
  }

  private fillLimitsPopover(popover: HTMLElement): void {
    const focused = this.focusedAgent
    const now = this.limitsNow
    const visible = this.lastLimitsArgs ? this.visibleAgents(this.lastLimitsArgs.state) : AGENTS
    const sections = allAgentLimits(this.limitStore, now).filter((entry) => visible.includes(entry.agent)).map((entry) => limitsSection(entry, entry.agent === focused, now, this.accounts))
    const link = h('button', { class: 'btn ghost small limits-usage-link', type: 'button', onClick: () => { this.closeLimitsPopover(); showView('usage') } }, 'Open Usage')
    const keep = popover.contains(document.activeElement) && document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('limits-usage-link')
    popover.replaceChildren(h('div', { class: 'popover-title' }, 'Limits by agent'), ...sections, h('div', { class: 'popover-foot limits-foot' }, link))
    if (keep) link.focus()
  }

}

function accountLine(account: AgentAccount | null): HTMLElement | null {
  if (!account) return null
  if (account.kind === 'none') return h('div', { class: 'limits-account none' }, 'Not signed in')
  const text = account.kind === 'apiKey' ? 'API key' : [account.email, account.plan].filter(Boolean).join(' · ')
  return h('div', { class: 'limits-account', title: text }, text)
}

function limitsSection(entry: AgentLimits, focused: boolean, now: number, accounts: AgentAccounts | null): HTMLElement {
  const name = agentLabel(entry.agent)
  const status = entry.state === 'none' ? 'no limits reported' : `updated ${dataAge(entry.at as number, now)}${entry.state === 'stale' ? ' · stale' : ''}`
  const windows = entry.windows.map((window) =>
    h('div', { class: `limits-row${window.resetsAt !== null && window.resetsAt <= now ? ' reset' : ''}`, 'data-limit': window.key },
      h('span', { class: 'limits-row-label' }, limitRowLabel(window)),
      chargeBar(window.percent, LIMIT_CELLS),
      h('span', { class: 'limits-row-value' }, formatPercent(window.percent)),
      h('span', { class: 'limits-row-reset' }, window.resetsAt === null ? '' : resetLine(window.resetsAt, now))
    )
  )
  return h('section', { class: `limits-agent-block${entry.state === 'stale' ? ' stale' : ''}`, 'data-agent': entry.agent, 'aria-label': name },
    h('div', { class: 'limits-agent-head' },
      agentMark(entry.agent),
      h('span', { class: 'limits-agent-title' }, name),
      focused ? h('span', { class: 'limits-focused' }, 'focused') : null,
      h('span', { class: 'limits-agent-age' }, status)
    ),
    entry.agent === 'claude' || entry.agent === 'codex' || entry.agent === 'gemini' ? accountLine(accounts?.[entry.agent] ?? null) : null,
    ...windows
  )
}

function resetLine(resetsAt: number, now: number): string {
  const left = formatResetIn(resetsAt, now)
  return left ? `resets in ${left}` : 'reset'
}

/** A nav button: the label always, plus an icon that stands in for the label on a narrow window (see topbar-narrow.css). */
function navButton(id: string, label: string, svg: string, hint: string | null, onClick: () => void): HTMLButtonElement {
  return h(
    'button',
    { class: 'btn ghost nav-button', type: 'button', id, 'aria-label': label, title: hint ? `${label} (${hint})` : label, onClick },
    h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon(svg)),
    h('span', { class: 'nav-label' }, label)
  )
}
