import { closeQuickPick, setQuickPickMode, showView, startSession } from '../actions'
import { AGENTS, AGENT_NAMES } from '../../shared/agents'
import {
  filterProjects,
  moveSelection,
  pickedAgent,
  toggleAgent,
  type AgentOverrides,
  type AgentPreset
} from '../../shared/quickPick'
import { formatPercent } from '../../shared/statusLine'
import type { AgentKind, Project, RateLimitWindow } from '../../shared/types'
import { primaryModifierPressed } from '../../shared/shortcuts'
import type { PaneView } from '../derive'
import { clear, h, icon } from '../dom'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { chargeBar } from './chargeBar'
import { modeTabs } from './pickerTabs'
import type { AppState } from '../state'
import { getTerminal } from '../terminals'
import { popupDismissButton } from './popupDismiss'

const MAC = navigator.platform.toLowerCase().includes('mac')

// Latest usage-limit windows any open pane reported for an agent.
function agentLimits(views: PaneView[], agent: AgentKind): RateLimitWindow[] {
  return views.find((view) => view.agent === agent && view.info.limits.length > 0)?.info.limits ?? []
}

export class QuickPickComponent {
  private root: HTMLElement | null = null
  private input: HTMLInputElement | null = null
  private list: HTMLElement | null = null
  private agents: HTMLElement | null = null
  private start: HTMLButtonElement | null = null
  private selected = 0
  private matches: Project[] = []
  private projects: Project[] = []
  private preset: AgentPreset = 'default'
  private overrides: AgentOverrides = {}
  private state: AppState | null = null
  private focusedAtOpen: string | null = null
  private views: PaneView[] = []

  constructor(private readonly anchor: () => HTMLElement) {}

  update(state: AppState, views: PaneView[] = []): void {
    const reportChanged = this.state?.agents.report !== state.agents.report
    this.state = state
    this.views = views
    this.projects = state.settings.projects
    this.preset = state.quickPickPreset
    const wanted = state.quickPickOpen && state.quickPickMode === 'new'
    if (wanted && !this.root) this.open()
    else if (wanted && reportChanged) this.renderAgents()
    if (!wanted && this.root) this.close(state.quickPickOpen)
  }

  private open(): void {
    this.focusedAtOpen = this.state?.focusedId ?? null
    this.input = h('input', {
      class: 'text-input rp-search',
      type: 'text',
      placeholder: 'Filter projects',
      'aria-label': 'Filter projects',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'quickpick-list',
      autocomplete: 'off'
    })
    this.list = h('div', { class: 'quickpick-list', id: 'quickpick-list', role: 'listbox', 'aria-label': 'Start a session in' })
    this.agents = h('div', { class: 'nd-agents', role: 'radiogroup', 'aria-label': 'Agent' })
    this.start = h('button', { class: 'btn primary nd-start', type: 'button', onClick: () => this.startSelected() }, 'Start')
    const hint = h(
      'span',
      { class: 'rp-hint' },
      h('span', { class: 'kbd' }, MAC ? 'Cmd+R' : 'Ctrl+R'),
      ' resume'
    )
    this.root = h(
      'div',
      { class: 'popover quickpick new-dialog', role: 'dialog', 'aria-label': 'New session' },
      h(
        'div',
        { class: 'rp-head' },
        h('div', { class: 'rp-top' }, modeTabs('new'), h('span', { class: 'spacer' }), hint, popupDismissButton(() => closeQuickPick())),
        h('div', { class: 'rp-search-wrap' }, icon(ICONS.search), this.input)
      ),
      h(
        'div',
        { class: 'nd-body' },
        h('section', { class: 'nd-col' }, h('h3', { class: 'nd-label' }, 'Project'), this.list),
        h('section', { class: 'nd-col nd-agent-col' }, h('h3', { class: 'nd-label' }, 'Agent'), this.agents)
      ),
      h(
        'div',
        { class: 'popover-foot nd-foot' },
        h('span', { class: 'nd-hint' }, `Enter starts a session. Tab switches agent. ${MAC ? 'Cmd' : 'Ctrl'}+R resumes`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', type: 'button', onClick: () => closeQuickPick() }, 'Cancel'),
        this.start
      )
    )
    this.selected = 0
    this.overrides = {}
    this.input.addEventListener('input', () => {
      this.selected = 0
      this.renderList()
    })
    this.input.addEventListener('keydown', (event) => this.onKey(event))
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeQuickPick()
    })
    document.body.appendChild(this.root)
    document.addEventListener('pointerdown', this.outside, true)
    this.renderList()
    this.input.focus()
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.root && !this.root.contains(target) && !this.anchor().contains(target)) closeQuickPick()
  }

  private close(stillOpen: boolean): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.root?.remove()
    this.root = null
    this.input = null
    this.list = null
    this.agents = null
    this.start = null
    if (stillOpen) return
    // A session started from here is the focused pane now: type into it, not the button that opened the pick.
    const pane = this.state?.focusedId !== this.focusedAtOpen ? this.state?.panes.find((p) => p.id === this.state?.focusedId) : undefined
    const terminal = pane ? getTerminal(pane.activeTabId) : undefined
    if (terminal) terminal.focus()
    else this.anchor().focus()
  }

  private startSelected(): void {
    const choice = this.matches[this.selected]
    if (choice) void startSession(choice.id, pickedAgent(choice, this.overrides, this.preset))
  }

  private onKey(event: KeyboardEvent): void {
    if (primaryModifierPressed(event) && !event.shiftKey && event.key.toLowerCase() === 'r') {
      event.preventDefault()
      event.stopPropagation()
      setQuickPickMode('resume')
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      this.selected = moveSelection(this.selected, event.key === 'ArrowDown' ? 1 : -1, this.matches.length)
      this.renderList()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      this.startSelected()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const choice = this.matches[this.selected]
      if (!choice) return
      this.overrides = toggleAgent(choice, this.overrides, this.preset)
      this.renderList()
    }
  }

  private renderList(): void {
    if (!this.list || !this.input) return
    this.matches = filterProjects(this.projects, this.input.value)
    this.selected = Math.min(this.selected, Math.max(0, this.matches.length - 1))
    clear(this.list)
    this.renderAgents()
    if (this.projects.length === 0) {
      this.list.append(
        h('p', { class: 'popover-empty' }, 'No projects yet.'),
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => { closeQuickPick(); showView('projects') } }, 'Add a project')
      )
      return
    }
    if (this.matches.length === 0) {
      this.list.append(h('p', { class: 'popover-empty' }, 'No project matches.'))
      return
    }
    this.matches.forEach((project, index) => {
      const agent = pickedAgent(project, this.overrides, this.preset)
      const option = h(
        'div',
        { class: `option${index === this.selected ? ' selected' : ''}`, role: 'option', id: `qp-${index}`, 'aria-selected': String(index === this.selected), title: project.folder },
        icon(ICONS.folder),
        h('span', { class: 'option-text' }, h('span', { class: 'option-name' }, project.name), h('span', { class: 'option-path' }, project.folder)),
        h('span', { class: 'option-agent' }, agentMark(agent), AGENT_NAMES[agent])
      )
      option.addEventListener('click', () => void startSession(project.id, agent))
      option.addEventListener('mousemove', () => {
        if (this.selected === index) return
        this.selected = index
        this.renderList()
      })
      this.list?.append(option)
    })
    this.list.querySelector('.option.selected')?.scrollIntoView({ block: 'nearest' })
    this.input.setAttribute('aria-activedescendant', `qp-${this.selected}`)
  }

  private renderAgents(): void {
    if (!this.agents || !this.start) return
    clear(this.agents)
    const project = this.matches[this.selected]
    this.start.disabled = !project
    if (!project) {
      this.start.textContent = 'Start'
      return
    }
    const current = pickedAgent(project, this.overrides, this.preset)
    this.start.textContent = `Start ${AGENT_NAMES[current]} in ${project.name}`
    const tools = this.state?.agents.report?.tools ?? []
    for (const agent of AGENTS) {
      const tool = tools.find((entry) => entry.agent === agent)
      const version = tool ? (tool.installed ? `v${tool.installed.replace(/^v/, '')}` : tool.present ? 'Installed' : 'Not installed') : null
      const limits = agentLimits(this.views, agent)
      const selected = agent === current
      const card = h(
        'button',
        {
          class: `nd-agent${selected ? ' selected' : ''}`,
          type: 'button',
          role: 'radio',
          'aria-checked': String(selected),
          tabindex: '-1',
          onClick: () => {
            this.overrides = { ...this.overrides, [project.id]: agent }
            this.renderList()
            this.input?.focus()
          }
        },
        h('span', { class: 'nd-agent-head' }, agentMark(agent), h('span', { class: 'nd-agent-name' }, AGENT_NAMES[agent]), version ? h('span', { class: 'nd-agent-version' }, version) : null),
        limits.length > 0
          ? h(
              'span',
              { class: 'nd-limits' },
              ...limits.map((window) =>
                h('span', { class: 'nd-limit' }, h('span', { class: 'nd-limit-label' }, window.label), chargeBar(window.percent), formatPercent(window.percent))
              )
            )
          : h('span', { class: 'nd-note' }, agent === 'gemini' ? "Doesn't report usage limits" : 'Limits show once a session reports them')
      )
      this.agents.append(card)
    }
  }
}
