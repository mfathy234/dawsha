import {
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
import { ICONS, logoMark } from '../icons'
import { agentMark } from './agentMark'
import { countSessions, type PaneView } from '../derive'
import { toolState } from '../../shared/agentTools'
import { formatPercent, gauge, gaugeStage } from '../../shared/statusLine'
import type { RateLimitWindow } from '../../shared/types'
import { h, icon } from '../dom'
import type { AppState } from '../state'

export class TopBarComponent {
  readonly el: HTMLElement
  readonly newSession = h(
    'button',
    {
      class: 'split-main',
      type: 'button',
      id: 'new-session',
      'aria-haspopup': 'listbox',
      'aria-label': 'New session, Ctrl+N',
      onClick: () => openQuickPick()
    },
    h('span', { class: 'new-session-icon', 'aria-hidden': 'true' }, icon(ICONS.plus)),
    h('span', { class: 'new-session-label' }, 'New session')
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
  readonly themeButton = h(
    'button',
    { class: 'btn ghost topbar-tool', type: 'button', id: 'theme-button', 'aria-label': 'Theme', 'aria-haspopup': 'dialog', onClick: () => toggleThemePicker() },
    h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon(ICONS.palette)),
    h('span', { class: 'utility-label' }, 'Theme')
  )
  private readonly projects = h('button', { class: 'btn ghost', type: 'button', id: 'projects-button' }, 'Projects')
  private readonly agentsDot = h('span', { class: 'update-dot', hidden: true, title: 'Agent updates available' })
  private readonly agents = h('button', { class: 'btn ghost', type: 'button', id: 'agents-button' }, 'Agents', this.agentsDot)
  private readonly skills = h('button', { class: 'btn ghost', type: 'button', id: 'skills-button' }, 'Skills')
  readonly layoutsButton = h(
    'button',
    { class: 'btn ghost', type: 'button', id: 'layouts-button', 'aria-haspopup': 'dialog', onClick: () => toggleLayouts() },
    'Layouts'
  )
  private readonly usage = h('button', { class: 'btn ghost', type: 'button', id: 'usage-button' }, 'Usage')
  private readonly settings = h('button', { class: 'btn ghost topbar-tool', type: 'button', id: 'settings-button', 'aria-label': 'Settings' },
    h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon(ICONS.settings)),
    h('span', { class: 'utility-label' }, 'Settings')
  )
  private readonly count = h('span', { class: 'topbar-count', 'aria-live': 'polite' })
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
    this.usage.addEventListener('click', () => {
      showView(this.usage.getAttribute('aria-pressed') === 'true' ? 'grid' : 'usage')
    })
    this.settings.addEventListener('click', () => {
      if (this.settings.getAttribute('aria-pressed') === 'true') showView('grid')
      else openSettings()
    })
    this.agents.addEventListener('click', () => {
      showView(this.agents.getAttribute('aria-pressed') === 'true' ? 'grid' : 'agents')
    })
    this.skills.addEventListener('click', () => {
      showView(this.skills.getAttribute('aria-pressed') === 'true' ? 'grid' : 'skills')
    })
    this.el = h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'app-logo' }, icon(logoMark(20))),
      h('span', { class: 'app-title' }, 'Dawsha'),
      h('div', { class: 'split' }, this.newSession, this.chevron),
      h('nav', { class: 'topbar-nav', 'aria-label': 'Main views' },
        this.projects,
        this.agents,
        this.skills,
        this.layoutsButton,
        this.usage
      ),
      this.count,
      this.updatePill,
      h('span', { class: 'spacer' }),
      this.limits,
      h('div', { class: 'topbar-tools' },
        h('div', { class: 'zoom-control', role: 'group', 'aria-label': 'Font size' },
          h('button', { class: 'btn ghost zoom-button', type: 'button', 'aria-label': 'Decrease font size', onClick: () => zoomAll(-1) }, 'A−'),
          h('button', { class: 'btn ghost zoom-button', type: 'button', 'aria-label': 'Increase font size', onClick: () => zoomAll(1) }, 'A+')
        ),
        this.settings,
        this.themeButton
      )
    )
  }

  update(state: AppState, views: PaneView[]): void {
    this.updateLimits(state, views)
    const { sessions, busy } = countSessions(views)
    this.projects.setAttribute('aria-pressed', String(state.view === 'projects'))
    this.agents.setAttribute('aria-pressed', String(state.view === 'agents'))
    this.skills.setAttribute('aria-pressed', String(state.view === 'skills'))
    this.usage.setAttribute('aria-pressed', String(state.view === 'usage'))
    this.settings.setAttribute('aria-pressed', String(state.view === 'settings'))
    const updates = state.agents.report?.tools.some((tool) => toolState(tool) === 'update') === true
    this.agentsDot.hidden = !updates
    this.agents.setAttribute('aria-label', updates ? 'Agents, updates available' : 'Agents')
    this.updatePillState(state)
    this.themeButton.setAttribute('aria-expanded', String(state.themePickerOpen))
    this.layoutsButton.setAttribute('aria-expanded', String(state.layoutsOpen))
    this.count.replaceChildren(
      `${sessions} session${sessions === 1 ? '' : 's'}`,
      ' · ',
      h('span', { class: busy > 0 ? 'busy' : '' }, `${busy} busy`)
    )
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
      h('span', { class: 'kbd' }, 'Ctrl+Shift+R')
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
      h('span', { class: 'kbd' }, 'Ctrl+Shift+A')
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
      this.closeAgentMenu()
    }
  }

  private updateLimits(state: AppState, views: PaneView[]): void {
    const windows = views.find((view) => view.pane.id === state.focusedId)?.info.limits ?? []
    const signature = JSON.stringify(windows)
    if (signature === this.limitsSignature) return
    this.limitsSignature = signature
    this.limits.hidden = windows.length === 0
    this.limits.replaceChildren(...windows.map((window) => limitItem(window)))
  }
}

function resetText(window: RateLimitWindow): string {
  if (window.resetsAt === null) return `${window.label}: ${formatPercent(window.percent)} used`
  const when = new Date(window.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return `${window.label}: ${formatPercent(window.percent)} used, resets ${when}`
}

function limitItem(window: RateLimitWindow): HTMLElement {
  return h(
    'span',
    { class: `limit stage-${gaugeStage(window.percent)}`, title: resetText(window), 'data-limit': window.key },
    h('span', { class: `limit-label${window.family ? ` fam-${window.family}` : ''}` }, window.label),
    ` ${gauge(window.percent)} ${formatPercent(window.percent)}`
  )
}
