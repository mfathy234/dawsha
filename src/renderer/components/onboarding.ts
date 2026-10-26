import { TOOL_NAMES } from '../../shared/agentTools'
import { AGENTS, agentOf } from '../../shared/agents'
import { STARTER_PROMPTS, onboardingProgress, pickStartAgent, starterPromptById } from '../../shared/onboardingSteps'
import type { AgentKind } from '../../shared/types'
import { addProject, dismissOnboarding, runAgentTask, showView, startSession } from '../actions'
import { api } from '../api'
import { h, icon } from '../dom'
import { store, type AppState } from '../state'
import { agentMark } from './agentMark'
import { addDismissButton } from './dialogs'

const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'

const READY_POLL_MS = 250
const READY_TIMEOUT_MS = 15_000
const AGENT_SETTLE_MS = 2500

function typeWhenReady(paneId: string, text: string): void {
  const started = Date.now()
  const poll = (): void => {
    const pane = store.state.panes.find((p) => p.id === paneId)
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId)
    if (!tab || Date.now() - started > READY_TIMEOUT_MS) return
    if (tab.status === 'running') {
      window.setTimeout(() => api.write(tab.id, text), AGENT_SETTLE_MS)
      return
    }
    window.setTimeout(poll, READY_POLL_MS)
  }
  poll()
}

export class OnboardingComponent {
  private root: HTMLElement | null = null
  private signature = ''
  private previous: HTMLElement | null = null
  private focused = false
  private starter: string | null = null

  update(state: AppState): void {
    if (state.onboardingOpen && !this.root) this.open()
    if (!state.onboardingOpen && this.root) this.close()
    if (this.root) this.render(state)
  }

  private open(): void {
    this.previous = document.activeElement as HTMLElement | null
    this.root = h('div', { class: 'overlay onboarding-overlay' })
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        dismissOnboarding()
      }
    })
    document.body.appendChild(this.root)
    this.signature = ''
    this.focused = false
    this.starter = null
  }

  private close(): void {
    this.root?.remove()
    this.root = null
    this.previous?.focus()
  }

  private step(index: number, state: 'done' | 'active' | 'locked', title: string, body: string | null, content: Node | null, action: Node | null): HTMLElement {
    return h(
      'li',
      { class: `ob-step ${state}`, 'data-step': String(index), 'aria-current': state === 'active' ? 'step' : undefined },
      h('span', { class: 'ob-num' }, state === 'done' ? icon(CHECK) : String(index)),
      h('div', { class: 'ob-text' }, h('h3', {}, title), body ? h('p', {}, body) : null, content),
      action
    )
  }

  private projectStep(state: AppState, active: boolean): HTMLElement {
    const project = state.settings.projects[state.settings.projects.length - 1]
    const add = h(
      'button',
      { class: `btn ${project ? 'ghost' : 'primary'} small`, type: 'button', id: 'ob-add-project', onClick: () => void addProject() },
      project ? 'Add another' : 'Add project'
    )
    if (!project) {
      return this.step(1, active ? 'active' : 'locked', 'Add a project', 'Pick a folder. Sessions you start open inside it.', null, add)
    }
    const summary = h('div', { class: 'ob-project' }, h('strong', {}, project.name), h('span', { class: 'ob-folder', title: project.folder }, project.folder))
    return this.step(1, 'done', 'Add a project', null, summary, add)
  }

  private agentCard(state: AppState, agent: AgentKind): HTMLElement {
    const tool = state.agents.report?.tools.find((t) => t.agent === agent)
    const name = TOOL_NAMES[agent]
    const ready = tool?.present === true
    const status = ready
      ? h('span', { class: 'ob-ready' }, icon(CHECK), tool.installed ? `Ready ${tool.installed}` : 'Ready')
      : h(
          'button',
          {
            class: 'btn small',
            type: 'button',
            id: `ob-install-${agent}`,
            'aria-label': `Install ${name}`,
            onClick: () => {
              dismissOnboarding()
              void runAgentTask([agent])
            }
          },
          'Install'
        )
    return h('div', { class: `ob-agent${ready ? ' ready' : ''}`, 'data-agent': agent }, h('span', { class: 'ob-agent-name' }, agentMark(agent), name), status)
  }

  private agentsStep(state: AppState, projectDone: boolean, done: boolean): HTMLElement {
    const report = state.agents.report
    const cards = report
      ? h('div', { class: 'ob-agents', id: 'ob-agents' }, ...AGENTS.map((agent) => this.agentCard(state, agent)))
      : h('p', { class: 'ob-agents-wait', id: 'ob-agents' }, 'Checking installed agents…')
    const open = h(
      'button',
      {
        class: 'tool-link',
        type: 'button',
        id: 'ob-open-agents',
        onClick: () => {
          dismissOnboarding()
          showView('agents')
        }
      },
      'Open Agent tools'
    )
    return this.step(2, done ? 'done' : projectDone ? 'active' : 'locked', 'Your agents', 'Dawsha runs the agent CLIs you already use.', cards, open)
  }

  private sessionStep(state: AppState, enabled: boolean): HTMLElement {
    const project = state.settings.projects[state.settings.projects.length - 1]
    const installed = state.agents.report?.tools.filter((t) => t.present).map((t) => t.agent) ?? null
    const agent = project ? pickStartAgent(agentOf(project), installed) : 'claude'
    const chips = h(
      'div',
      { class: 'ob-chips', role: 'group', 'aria-label': 'Starter prompt' },
      ...STARTER_PROMPTS.map((prompt) =>
        h(
          'button',
          {
            class: `chip ob-chip${this.starter === prompt.id ? ' on' : ''}`,
            type: 'button',
            disabled: !enabled,
            'aria-pressed': String(this.starter === prompt.id),
            'data-starter': prompt.id,
            onClick: () => {
              this.starter = this.starter === prompt.id ? null : prompt.id
              this.signature = ''
              this.render(store.state)
              this.root?.querySelector<HTMLElement>(`[data-starter="${prompt.id}"]`)?.focus()
            }
          },
          prompt.label
        )
      )
    )
    const start = h(
      'button',
      {
        class: 'btn primary',
        type: 'button',
        id: 'ob-start',
        disabled: !enabled || !project,
        onClick: () => void this.start(project?.id ?? null, agent)
      },
      project ? `Start ${TOOL_NAMES[agent]} in ${project.name}` : 'Start a session'
    )
    return this.step(3, enabled ? 'active' : 'locked', 'Start your first session', enabled ? 'Pick a prompt to type for you, or start empty.' : 'Add a project first.', h('div', { class: 'ob-start' }, chips, start), null)
  }

  private async start(projectId: string | null, agent: AgentKind): Promise<void> {
    if (!projectId) return
    const prompt = starterPromptById(this.starter)
    dismissOnboarding()
    await startSession(projectId, agent)
    const paneId = store.state.focusedId
    if (prompt && paneId) typeWhenReady(paneId, prompt.text)
  }

  private render(state: AppState): void {
    if (!this.root) return
    const projectDone = state.settings.projects.length > 0
    const installed = state.agents.report?.tools.filter((t) => t.present).length ?? 0
    const signature = JSON.stringify([
      state.settings.projects.map((p) => [p.id, p.name, p.folder, p.defaultAgent]),
      state.agents.report?.tools.map((t) => [t.agent, t.present, t.installed]),
      this.starter
    ])
    if (signature === this.signature) return
    this.signature = signature
    const hadFocus = this.root.contains(document.activeElement)
    const progress = onboardingProgress({ projects: state.settings.projects.length, installedAgents: installed })
    const close = h(
      'button',
      { class: `btn ${projectDone ? 'primary' : 'ghost'}`, type: 'button', id: 'ob-close', onClick: () => dismissOnboarding() },
      projectDone ? 'Done' : 'Skip'
    )
    const dialog = h(
      'div',
      { class: 'dialog onboarding', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ob-title' },
      h(
        'div',
        { class: 'ob-head' },
        h('h2', { id: 'ob-title' }, 'Set up Dawsha'),
        h('span', { class: 'ob-progress-label', id: 'ob-progress-label' }, progress.label)
      ),
      h(
        'div',
        {
          class: 'ob-progress',
          role: 'progressbar',
          'aria-label': 'Setup progress',
          'aria-valuemin': 0,
          'aria-valuemax': progress.total,
          'aria-valuenow': progress.done,
          'aria-valuetext': `${progress.label} steps done`
        },
        h('div', { class: 'ob-progress-fill', style: `width:${progress.percent}%` })
      ),
      h(
        'ol',
        { class: 'ob-steps' },
        this.projectStep(state, progress.active === 1),
        this.agentsStep(state, projectDone, installed > 0),
        this.sessionStep(state, projectDone)
      ),
      h('p', { class: 'ob-tip' }, 'Tip: run ', h('code', {}, 'dawsha .'), ' in any folder to open it here.'),
      h('p', { class: 'ob-privacy' }, 'Everything stays on this computer. Nothing is sent anywhere.'),
      h('div', { class: 'dialog-actions' }, close)
    )
    addDismissButton(dialog, () => dismissOnboarding())
    this.root.replaceChildren(dialog)
    if (hadFocus || !this.focused) {
      const primary = dialog.querySelector<HTMLElement>('.btn.primary:not(:disabled)')
      ;(primary ?? close).focus()
    }
    this.focused = true
  }
}
