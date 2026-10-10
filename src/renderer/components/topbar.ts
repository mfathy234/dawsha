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
import { newestLimits } from '../../shared/opsFeed'
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
    'New session',
    h('span', { class: 'kbd' }, 'Ctrl+N')
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
    { class: 'btn ghost', type: 'button', id: 'theme-button', 'aria-haspopup': 'dialog', onClick: () => toggleThemePicker() },
    'Theme'
  )
  private readonly projects = h('button', { class: 'btn ghost', type: 'button', id: 'projects-button' }, 'Projects')
  private readonly agentsDot = h('span', { class: 'update-dot', hidden: true, title: 'Agent updates available' })
  private readonly agents = h('button', { class: 'btn ghost', type: 'button', id: 'agents-button' }, 'Agents', this.agentsDot)
  readonly layoutsButton = h(
    'button',
    { class: 'btn ghost', type: 'button', id: 'layouts-button', 'aria-haspopup': 'dialog', onClick: () => toggleLayouts() },
    'Layouts'
  )
  private readonly usage = h('button', { class: 'btn ghost', type: 'button', id: 'usage-button' }, 'Usage')
  private readonly settings = h('button', { class: 'btn ghost', type: 'button', id: 'settings-button' }, 'Settings')
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
    this.el = h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'app-logo' }, icon(logoMark(20))),
      h('span', { class: 'app-title' }, 'Dawsha'),
      h('div', { class: 'split' }, this.newSession, h('span', { class: 'split-sep' }), this.chevron),
      this.projects,
      this.agents,
      this.layoutsButton,
      this.usage,
      this.count,
      this.updatePill,
      h('span', { class: 'spacer' }),
      this.limits,
      h('button', { class: 'btn ghost compact', type: 'button', 'aria-label': 'Decrease font size', onClick: () => zoomAll(-1) }, 'A−'),
      h('button', { class: 'btn ghost compact', type: 'button', 'aria-label': 'Increase font size', onClick: () => zoomAll(1) }, 'A+'),
      this.settings,
      this.themeButton
    )
  }

  update(state: AppState, views: PaneView[]): void {
    this.updateLimits(state)
    const { sessions, busy } = countSessions(views)
    this.projects.setAttribute('aria-pressed', String(state.view === 'projects'))
    this.agents.setAttribute('aria-pressed', String(state.view === 'agents'))
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

  private updateLimits(state: AppState): void {
    const statuses = state.bridge.installed ? Object.values(state.statusInfo) : []
    const windows = newestLimits(statuses, Object.values(state.opsInfo))?.windows ?? []
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
