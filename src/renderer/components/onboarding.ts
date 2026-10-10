import { TOOL_NAMES } from '../../shared/agentTools'
import { AGENTS } from '../../shared/agents'
import { addProject, dismissOnboarding, showView } from '../actions'
import { h, icon } from '../dom'
import type { AppState } from '../state'

const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'

export class OnboardingComponent {
  private root: HTMLElement | null = null
  private signature = ''
  private previous: HTMLElement | null = null
  private focused = false

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
  }

  private close(): void {
    this.root?.remove()
    this.root = null
    this.previous?.focus()
  }

  private step(index: number, done: boolean, title: string, body: string, detail: HTMLElement | null, action: HTMLElement): HTMLElement {
    return h(
      'li',
      { class: `ob-step${done ? ' done' : ''}`, 'data-step': String(index) },
      h('span', { class: 'ob-num' }, done ? icon(CHECK) : String(index)),
      h(
        'div',
        { class: 'ob-text' },
        h('h3', {}, title),
        h('p', {}, body),
        detail
      ),
      h('span', { class: 'ob-state' }, done ? 'Done' : 'To do'),
      action
    )
  }

  private agentLine(state: AppState): HTMLElement {
    const report = state.agents.report
    if (!report) return h('p', { class: 'ob-agents' }, 'Checking installed agents…')
    const parts = AGENTS.map((agent) => {
      const tool = report.tools.find((t) => t.agent === agent)
      const installed = tool?.present === true
      return `${TOOL_NAMES[agent]} ${installed ? (tool?.installed ? `${tool.installed} installed` : 'installed') : 'not installed'}`
    })
    return h('p', { class: 'ob-agents', id: 'ob-agents' }, parts.join(' · '))
  }

  private render(state: AppState): void {
    if (!this.root) return
    const projectDone = state.settings.projects.length > 0
    const installed = state.agents.report?.tools.filter((t) => t.present).length ?? 0
    const signature = JSON.stringify([projectDone, state.agents.report?.tools.map((t) => [t.agent, t.present, t.installed])])
    if (signature === this.signature) return
    this.signature = signature
    const hadFocus = this.root.contains(document.activeElement)
    const addButton = h(
      'button',
      { class: `btn ${projectDone ? 'ghost' : 'primary'}`, type: 'button', id: 'ob-add-project', onClick: () => void addProject() },
      projectDone ? 'Add another' : 'Add project'
    )
    const agentsButton = h(
      'button',
      {
        class: 'btn ghost',
        type: 'button',
        id: 'ob-open-agents',
        onClick: () => {
          dismissOnboarding()
          showView('agents')
        }
      },
      'Open Agents'
    )
    const close = h(
      'button',
      { class: `btn ${projectDone ? 'primary' : 'ghost'}`, type: 'button', id: 'ob-close', onClick: () => dismissOnboarding() },
      projectDone ? 'Done' : 'Skip'
    )
    const dialog = h(
      'div',
      { class: 'dialog onboarding', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ob-title' },
      h('h2', { id: 'ob-title' }, 'Set up Dawsha'),
      h('p', { class: 'ob-lede' }, 'Two quick steps. You can skip the last one.'),
      h(
        'ol',
        { class: 'ob-steps' },
        this.step(1, projectDone, 'Add a project', 'Pick a folder. Sessions you start open inside it.', null, addButton),
        this.step(2, installed > 0, 'Install your agents', 'Dawsha runs the agent CLIs you already use.', this.agentLine(state), agentsButton)
      ),
      h('p', { class: 'ob-tip' }, 'Tip: run ', h('code', {}, 'dawsha .'), ' in any folder to open it here.'),
      h('p', { class: 'ob-privacy' }, 'Everything stays on this computer. Nothing is sent anywhere.'),
      h('div', { class: 'dialog-actions' }, close)
    )
    this.root.replaceChildren(dialog)
    if (hadFocus || !this.focused) close.focus()
    this.focused = true
  }
}
