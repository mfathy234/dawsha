import { AGENT_NAMES } from '../../shared/agents'
import { MINI_START_MAX } from '../../shared/miniStart'
import type { MiniStartOptions } from '../../shared/miniStart'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'

export interface StartHost {
  start(projectId: string, agent: AgentKind, text: string): void
  cancel(): void
}

/** The small form for a new session: a project, an agent and an optional first message. */
export class StartForm {
  readonly el: HTMLFormElement
  private readonly project: HTMLSelectElement
  private readonly agent: HTMLSelectElement
  private readonly message = h('input', { class: 'mini-input mini-start-text', type: 'text', dir: 'auto', 'aria-label': 'First message, optional', placeholder: 'First message (optional)', maxlength: MINI_START_MAX, autocomplete: 'off' })

  constructor(private readonly options: MiniStartOptions, private readonly host: StartHost) {
    this.project = h('select', { class: 'mini-select-field', id: 'mini-start-project' }, ...options.projects.map(p => h('option', { value: p.id }, p.name))) as HTMLSelectElement
    this.agent = h('select', { class: 'mini-select-field', id: 'mini-start-agent' }, ...options.agents.map(a => h('option', { value: a }, AGENT_NAMES[a]))) as HTMLSelectElement
    const start = h('button', { type: 'submit', class: 'mini-start-go' }, 'Start')
    if (options.projects.length === 0 || options.agents.length === 0) start.setAttribute('disabled', '')
    this.el = h('form', { class: 'mini-start', 'aria-label': 'New session' },
      h('label', { for: 'mini-start-project' }, 'Project'), this.project,
      h('label', { for: 'mini-start-agent' }, 'Agent'), this.agent,
      this.message,
      h('p', { class: 'mini-start-note', role: 'status' }, options.projects.length === 0 ? 'Add a project in Dawsha first.' : options.agents.length === 0 ? 'No agent is installed.' : ''),
      h('div', { class: 'mini-start-actions' }, h('button', { type: 'button', class: 'mini-start-cancel', onClick: () => host.cancel() }, 'Cancel'), start)) as HTMLFormElement
    this.project.addEventListener('change', () => this.pickDefaultAgent())
    this.pickDefaultAgent()
    this.el.addEventListener('submit', event => { event.preventDefault(); this.submit() })
    this.el.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      host.cancel()
    })
    queueMicrotask(() => this.project.focus({ preventScroll: true }))
  }

  private pickDefaultAgent(): void {
    const preferred = this.options.projects.find(p => p.id === this.project.value)?.agent
    if (preferred && this.options.agents.includes(preferred)) this.agent.value = preferred
  }

  private submit(): void {
    const agent = this.agent.value as AgentKind
    if (!this.project.value || !this.options.agents.includes(agent)) return
    this.host.start(this.project.value, agent, this.message.value.trim())
  }
}
