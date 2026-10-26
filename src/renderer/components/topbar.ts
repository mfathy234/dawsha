import {
  focusNextAttention,
  openQuickPick,
  openSettings,
  openResumePicker,
  showView,
  toggleLayouts,
  toggleThemePicker,
  toggleUpdatePopover,
  zoomAll
} from '../actions'
import { pillLabel, showUpdatePill } from '../../shared/updates'
import { AGENTS, AGENT_NAMES } from '../../shared/agents'
import type { AgentKind } from '../../shared/types'
import { openCompareDialog } from '../compareActions'
import { ICONS } from '../icons'
import faviconSvg from '../../../site/favicon.svg?raw'
import { agentMark } from './agentMark'
import type { PaneView } from '../derive'
import { countSessionStates, sessionState } from '../../shared/sessionState'
import { MORE_VIEWS, accountLimits, limitText, moreLabel, type MoreView } from '../../shared/topbarSummary'
import { stateIcon } from './stateIcon'
import { toolState } from '../../shared/agentTools'
import { formatPercent, gaugeStage } from '../../shared/statusLine'
import { chargeBar } from './chargeBar'
import type { RateLimitWindow } from '../../shared/types'
import { h, icon } from '../dom'
import type { AppState } from '../state'
import { bind, formatShortcut } from '../../shared/shortcuts'
import { setSessionsLayout } from '../sessionsLayout'
import { NotificationBell } from './notificationBell'
import { onAgentsChange, runningAgents } from '../backgroundAgents'

const ZOOM_MOD = navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'

const NEEDS_KEY_HINT = formatShortcut(bind('Ctrl+Shift+J'))
const BOARD_KEY_HINT = formatShortcut(bind('Ctrl+Shift+B'))
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
      'aria-haspopup': 'listbox',
      'aria-label': `New session, ${formatShortcut(bind('Ctrl+N'))}`,
      onClick: () => openQuickPick()
    },
    h('span', { class: 'new-session-icon', 'aria-hidden': 'true' }, icon(ICONS.plus)),
    h('span', { class: 'new-session-label' }, 'New session'),
    h('span', { class: 'new-session-kbd', 'aria-hidden': 'true' }, formatShortcut(bind('Ctrl+N')))
  )
  private readonly chevron = h(
    'button',
    {
      class: 'split-chevron',
      type: 'button',
      id: 'new-session-agent',
      'aria-label': 'Choose agent',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onClick: () => this.toggleAgentMenu()
    },
    icon(ICONS.chevronDown)
  )
  private agentMenu: HTMLElement | null = null
  private readonly bell = new NotificationBell()
  readonly themeButton = h(
    'button',
    { class: 'btn ghost topbar-tool', type: 'button', id: 'theme-button', 'aria-label': 'Theme', title: 'Theme', 'aria-haspopup': 'dialog', onClick: () => toggleThemePicker() },
    h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon(ICONS.palette)),
    h('span', { class: 'utility-label' }, 'Theme')
  )
  private readonly sessions = h('button', { class: 'btn ghost', type: 'button', id: 'sessions-button', onClick: () => showView('grid') }, 'Sessions')
  private readonly agentsBadge = h('span', { class: 'bg-badge', hidden: true, 'aria-hidden': 'true' })
  private readonly background = h('button', { class: 'btn ghost', type: 'button', id: 'background-button', title: `Background agents (${AGENTS_KEY_HINT})`, onClick: () => showView(this.background.getAttribute('aria-pressed') === 'true' ? 'grid' : 'background') }, 'Agents', this.agentsBadge)
  private readonly files = h('button', { class: 'btn ghost', type: 'button', id: 'files-button', title: `Files (${FILES_KEY_HINT})`, onClick: () => showView(this.files.getAttribute('aria-pressed') === 'true' ? 'grid' : 'files') }, 'Files')
  private readonly projects = h('button', { class: 'btn ghost', type: 'button', id: 'projects-button' }, 'Projects')
  private readonly moreDot = h('span', { class: 'update-dot', hidden: true, title: 'Agent updates available' })
  private readonly moreText = h('span', { class: 'more-text' }, 'More')
  private readonly more = h(
    'button',
    { class: 'btn ghost more-button', type: 'button', id: 'more-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: () => this.toggleMoreMenu() },
    this.moreText,
    h('span', { class: 'more-chevron', 'aria-hidden': 'true' }, icon(ICONS.chevronDown)),
    this.moreDot
  )
  readonly layoutsButton = this.more
  private moreMenu: HTMLElement | null = null
  private moreItems: Record<MoreView, HTMLElement> | null = null
  private agentUpdates = false
  private activeMore: MoreView | null = null
  private readonly usage = h('button', { class: 'btn ghost', type: 'button', id: 'usage-button' }, 'Usage')
  private readonly work = h('button', { class: 'btn ghost', type: 'button', id: 'work-button', onClick: () => showView(this.work.getAttribute('aria-pressed') === 'true' ? 'grid' : 'work') }, 'Work')
  private readonly orchBadge = h('span', { class: 'orch-badge', hidden: true })
  private readonly orchestrator = h('button', { class: 'btn ghost', type: 'button', id: 'orchestrator-button', hidden: true }, 'Orchestrator', this.orchBadge)
  private readonly settings = h('button', { class: 'btn ghost topbar-tool', type: 'button', id: 'settings-button', 'aria-label': 'Settings', title: 'Settings' },
    h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon(ICONS.settings)),
    h('span', { class: 'utility-label' }, 'Settings')
  )
  private readonly gridMode = h('button', { class: 'btn ghost', type: 'button', id: 'layout-grid', title: 'Show sessions as a grid', onClick: () => setSessionsLayout('grid') }, 'Grid')
  private readonly boardMode = h('button', { class: 'btn ghost', type: 'button', id: 'layout-board', title: `Show sessions as a board (${BOARD_KEY_HINT})`, onClick: () => setSessionsLayout('board') }, 'Board')
  private readonly summary = h('div', { class: 'topbar-count', role: 'status', 'aria-live': 'polite' })
  private summarySignature = ''
  private readonly zoomValue = h('span', { class: 'zoom-value', title: 'Terminal text size of the focused pane' }, '15px')
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
  private readonly limits = h('span', { class: 'topbar-limits', hidden: true })
  private limitsSignature = ''

  constructor() {
    this.projects.addEventListener('click', () => {
      showView(this.projects.getAttribute('aria-pressed') === 'true' ? 'grid' : 'projects')
    })
    this.orchestrator.addEventListener('click', () => {
      if (this.orchestrator.getAttribute('aria-pressed') === 'true') showView('grid')
      else showView('orchestrator')
    })
    this.usage.addEventListener('click', () => {
      showView(this.usage.getAttribute('aria-pressed') === 'true' ? 'grid' : 'usage')
    })
    this.settings.addEventListener('click', () => {
      if (this.settings.getAttribute('aria-pressed') === 'true') showView('grid')
      else openSettings()
    })
    onAgentsChange(() => this.updateAgentsBadge())
    this.el = h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'app-logo', 'aria-hidden': 'true' }, icon(faviconSvg)),
      h('span', { class: 'app-title' }, 'Dawsha'),
      h('div', { class: 'split' }, this.newSession, this.chevron),
      h('nav', { class: 'topbar-nav', 'aria-label': 'Main views' },
        this.sessions,
        this.background,
        this.files,
        this.projects,
        this.usage,
        this.work,
        this.orchestrator,
        this.more
      ),
      this.summary,
      this.updatePill,
      h('span', { class: 'spacer' }),
      h('div', { class: 'layout-switch', role: 'group', 'aria-label': 'Sessions layout' }, this.gridMode, this.boardMode),
      this.limits,
      h('div', { class: 'topbar-tools' },
        h('div', { class: 'zoom-control', role: 'group', 'aria-label': 'Font size' },
          h('button', { class: 'btn ghost zoom-button', type: 'button', 'aria-label': 'Decrease font size', title: `Smaller text in every pane (${ZOOM_MOD}+- for the focused pane only)`, onClick: () => zoomAll(-1) }, icon(ICONS.minus)),
          this.zoomValue,
          h('button', { class: 'btn ghost zoom-button', type: 'button', 'aria-label': 'Increase font size', title: `Larger text in every pane (${ZOOM_MOD}+= for the focused pane only)`, onClick: () => zoomAll(1) }, icon(ICONS.plus))
        ),
        this.bell.el,
        this.themeButton,
        this.settings
      )
    )
  }

  update(state: AppState, views: PaneView[]): void {
    this.updateLimits(state, views)
    this.updateOrchestrator(state)
    this.sessions.setAttribute('aria-pressed', String(state.view === 'grid'))
    this.gridMode.setAttribute('aria-pressed', String(state.settings.sessionsLayout === 'grid'))
    this.boardMode.setAttribute('aria-pressed', String(state.settings.sessionsLayout === 'board'))
    this.background.setAttribute('aria-pressed', String(state.view === 'background'))
    this.files.setAttribute('aria-pressed', String(state.view === 'files'))
    this.projects.setAttribute('aria-pressed', String(state.view === 'projects'))
    this.usage.setAttribute('aria-pressed', String(state.view === 'usage'))
    this.work.setAttribute('aria-pressed', String(state.view === 'work'))
    this.settings.setAttribute('aria-pressed', String(state.view === 'settings'))
    this.agentUpdates = state.agents.report?.tools.some((tool) => toolState(tool) === 'update') === true
    this.updateMore(state)
    this.updatePillState(state)
    const focused = state.panes.find((pane) => pane.id === state.focusedId) ?? state.panes[0]
    this.zoomValue.textContent = focused ? `${focused.fontSize}px` : '15px'
    this.themeButton.setAttribute('aria-expanded', String(state.themePickerOpen))
    this.updateSummary(views)
  }

  private updateAgentsBadge(): void {
    const running = runningAgents()
    this.agentsBadge.hidden = running === 0
    this.agentsBadge.textContent = String(running)
    this.background.setAttribute('aria-label', running > 0 ? `Agents, ${running} running` : 'Agents')
  }

  private updateMore(state: AppState): void {
    this.activeMore = state.layoutsOpen ? 'layouts' : state.view === 'agents' || state.view === 'skills' ? state.view : null
    const label = moreLabel(this.activeMore ?? '')
    this.more.setAttribute('aria-pressed', String(this.activeMore !== null))
    this.more.setAttribute('aria-expanded', String(this.moreMenu !== null || state.layoutsOpen))
    this.more.setAttribute('aria-label', this.agentUpdates ? `${label}, agent updates available` : label)
    this.moreText.textContent = label
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

  private updateSummary(views: PaneView[]): void {
    const counts = countSessionStates(views.map((view) => sessionState(view)))
    const signature = JSON.stringify(counts)
    if (signature === this.summarySignature) return
    this.summarySignature = signature
    const chips: HTMLElement[] = [h('span', { class: 'sum-chip' }, `${counts.total} session${counts.total === 1 ? '' : 's'}`)]
    if (counts.working > 0) chips.push(h('span', { class: 'sum-chip state-working' }, stateIcon('working'), `${counts.working} working`))
    if (counts.needs > 0) {
      chips.push(
        h(
          'button',
          {
            class: 'sum-chip sum-needs',
            type: 'button',
            id: 'needs-chip',
            title: `Go to the session that needs you (${NEEDS_KEY_HINT})`,
            'aria-label': `${counts.needs} needs you, go to the next one, ${NEEDS_KEY_HINT}`,
            onClick: () => {
              if (!focusNextAttention()) showView('grid')
            }
          },
          stateIcon('needs'),
          `${counts.needs} needs you`,
          h('span', { class: 'kbd', 'aria-hidden': 'true' }, NEEDS_KEY_HINT)
        )
      )
    }
    if (counts.done > 0) chips.push(h('span', { class: 'sum-chip state-done' }, stateIcon('done'), `${counts.done} to review`))
    if (counts.idle > 0) chips.push(h('span', { class: 'sum-chip state-idle' }, stateIcon('idle'), `${counts.idle} idle`))
    this.summary.replaceChildren(...chips)
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
    this.agentMenu?.remove()
    this.agentMenu = null
    this.chevron.setAttribute('aria-expanded', 'false')
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
    items.push(resume, compare)
    const rect = this.newSession.getBoundingClientRect()
    this.agentMenu = h(
      'div',
      { class: 'popover menu floating', role: 'menu', 'aria-label': 'Choose agent', style: `left:${Math.round(rect.left)}px;top:${Math.round(rect.bottom + 6)}px` },
      ...items
    )
    this.agentMenu.addEventListener('keydown', (event) => this.onMenuKey(event, items))
    this.chevron.setAttribute('aria-expanded', 'true')
    document.body.appendChild(this.agentMenu)
    items[0].focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0)
  }

  private onMenuKey(event: KeyboardEvent, items: HTMLElement[]): void {
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closeAgentMenu()
      this.chevron.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(current + step + items.length) % items.length].focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1].focus()
    } else if (event.key === 'Tab') {
      // Move focus back to the anchor before the menu leaves the DOM, so Tab continues from there.
      this.chevron.focus()
      this.closeAgentMenu()
    }
  }

  private readonly moreOutside = (event: Event): void => {
    const target = event.target as Node
    if (this.moreMenu && !this.moreMenu.contains(target) && !this.more.contains(target)) this.closeMoreMenu()
  }

  private closeMoreMenu(): void {
    document.removeEventListener('pointerdown', this.moreOutside, true)
    this.moreMenu?.remove()
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
    const entries = MORE_VIEWS.map(({ view, label }) => {
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
    for (const { view } of MORE_VIEWS) this.markMoreItem(view)
    const rect = this.more.getBoundingClientRect()
    this.moreMenu = h(
      'div',
      { class: 'popover menu floating', role: 'menu', 'aria-label': 'More views', style: `left:${Math.round(rect.left)}px;top:${Math.round(rect.bottom + 6)}px` },
      ...items
    )
    this.moreMenu.addEventListener('keydown', (event) => this.onMoreKey(event, items))
    this.more.setAttribute('aria-expanded', 'true')
    document.body.appendChild(this.moreMenu)
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

  private updateLimits(state: AppState, views: PaneView[]): void {
    const focusedIndex = views.findIndex((view) => view.pane.id === state.focusedId)
    const windows = accountLimits(views.map((view) => view.info.limits), focusedIndex)
    const items = windows.map((window) => ({ window, text: limitText(window, state.now), title: resetText(window) }))
    const signature = JSON.stringify(items)
    if (signature === this.limitsSignature) return
    this.limitsSignature = signature
    this.limits.hidden = items.length === 0
    this.limits.replaceChildren(...items.map((item) => limitItem(item.window, item.text, item.title)))
  }

  private updateOrchestrator(state: AppState): void {
    const enabled = state.settings.experimental.orchestrator
    this.orchestrator.hidden = !enabled
    this.orchestrator.setAttribute('aria-pressed', String(state.view === 'orchestrator'))
    const waiting = state.orch?.decisions.length ?? 0
    this.orchBadge.hidden = waiting === 0
    this.orchBadge.textContent = String(waiting)
    this.orchestrator.title = waiting ? `Orchestrator: ${waiting} waiting for you` : 'Orchestrator'
  }
}

function resetText(window: RateLimitWindow): string {
  if (window.resetsAt === null) return `${window.label}: ${formatPercent(window.percent)} used`
  const when = new Date(window.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return `${window.label}: ${formatPercent(window.percent)} used, resets ${when}`
}

function limitItem(window: RateLimitWindow, text: string, title: string): HTMLElement {
  return h(
    'span',
    { class: `limit stage-${gaugeStage(window.percent)}`, title, 'data-limit': window.key },
    h('span', { class: `limit-label${window.family ? ` fam-${window.family}` : ''}` }, window.label),
    ' ',
    chargeBar(window.percent),
    ' ',
    h('span', { class: 'limit-value' }, text)
  )

}
