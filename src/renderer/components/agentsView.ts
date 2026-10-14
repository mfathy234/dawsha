import { refreshAgentTools, runAgentTask, setFullAccess } from '../actions'
import { api } from '../api'
import { AGENTS, FULL_ACCESS_FLAGS } from '../../shared/agents'
import {
  NODE_DOWNLOAD_URL,
  NODE_NOTE,
  TOOL_NAMES,
  nodeProblem,
  sourceLine,
  toolCommand,
  toolState,
  type ToolReport
} from '../../shared/agentTools'
import type { AgentKind } from '../../shared/types'
import { clear, h } from '../dom'
import { agentMark } from './agentMark'
import type { AppState } from '../state'

type NodeInfo = NonNullable<AppState['agents']['report']>['node']

const DESCRIPTIONS: Record<AgentKind, string> = {
  claude: "Anthropic's coding agent for your terminal.",
  codex: "OpenAI's coding agent for your terminal.",
  gemini: "Google's coding agent for your terminal."
}

export class AgentsViewComponent {
  readonly el = h('main', { class: 'agents-view', 'aria-label': 'Agents' })
  private readonly rows = h('div', { class: 'tool-list' })
  private readonly check = h(
    'button',
    { class: 'btn ghost', type: 'button', id: 'agents-check', onClick: () => void refreshAgentTools(true) },
    'Check again'
  )
  private readonly updateAll = h(
    'button',
    { class: 'btn primary', type: 'button', id: 'agents-update-all', onClick: () => void runAgentTask('updates') },
    'Update all'
  )
  private readonly shown = new Set<AgentKind>()
  private signature = ''
  private current: AppState | null = null

  constructor() {
    this.el.append(
      h(
        'div',
        { class: 'agents-head' },
        h(
          'div',
          { class: 'agents-title' },
          h('h1', {}, 'Agents'),
          h('p', { class: 'lede' }, 'Install or update the command-line agents this app runs. Commands run in a visible shell tab.')
        ),
        this.check,
        this.updateAll
      ),
      this.rows
    )
  }

  update(state: AppState): void {
    this.current = state
    const { report, checking } = state.agents
    const signature = JSON.stringify([report, checking, [...this.shown], state.info.shellCommand, state.settings.fullAccess])
    if (signature === this.signature) return
    this.signature = signature
    this.check.disabled = checking
    this.check.textContent = checking ? 'Checking…' : 'Check again'
    const updates = report ? report.tools.filter((tool) => toolState(tool) === 'update').length : 0
    this.updateAll.disabled = updates === 0
    this.updateAll.textContent = updates > 0 ? `Update ${updates} agent${updates === 1 ? '' : 's'}` : 'Update all'
    clear(this.rows)
    if (!report) {
      this.rows.append(h('p', { class: 'tool-empty' }, 'Checking installed agents…'))
      return
    }
    for (const agent of AGENTS) {
      const tool = report.tools.find((t) => t.agent === agent)
      if (tool) this.rows.append(this.card(tool, report.node, state.settings.fullAccess[agent]))
    }
  }

  private card(tool: ToolReport, node: NodeInfo, fullAccess: boolean): HTMLElement {
    const command = toolCommand(tool)
    const shown = this.shown.has(tool.agent)
    const state = toolState(tool)
    const toggle = h(
      'button',
      {
        class: 'tool-link',
        type: 'button',
        'aria-expanded': String(shown),
        onClick: () => {
          if (this.shown.has(tool.agent)) this.shown.delete(tool.agent)
          else this.shown.add(tool.agent)
          this.signature = ''
          if (this.current) this.update(this.current)
        }
      },
      shown ? 'Hide command' : 'Show command'
    )
    const card = h(
      'div',
      { class: `tool-block${tool.present ? '' : ' missing'}`, 'data-agent': tool.agent, 'data-state': state },
      h(
        'div',
        { class: 'tool-row' },
        agentMark(tool.agent, 'tool-badge'),
        h('div', { class: 'tool-id' }, h('div', { class: 'tool-name' }, TOOL_NAMES[tool.agent]), h('div', { class: 'tool-source' }, sourceLine(tool))),
        this.status(tool)
      ),
      tool.present ? this.versions(tool) : h('p', { class: 'tool-desc' }, DESCRIPTIONS[tool.agent]),
      this.fullAccessToggle(tool.agent, fullAccess),
      h('div', { class: 'tool-actions' }, this.action(tool, command, node), toggle)
    )
    if (shown) card.append(h('pre', { class: 'tool-command' }, command.text))
    return card
  }

  private versions(tool: ToolReport): HTMLElement {
    const line = (label: string, value: Node | string): HTMLElement =>
      h('div', { class: 'tool-version' }, h('span', { class: 'tool-version-label' }, label), h('span', { class: 'tool-version-value' }, value))
    return h(
      'div',
      { class: 'tool-versions' },
      line('Installed', tool.installed ?? 'version unknown'),
      line('Latest', tool.latest ?? h('span', { class: 'tool-flag muted' }, "couldn't check"))
    )
  }

  private fullAccessToggle(agent: AgentKind, checked: boolean): HTMLElement {
    const id = `full-access-${agent}`
    const input = h('input', { type: 'checkbox', id })
    input.checked = checked
    input.addEventListener('change', () => setFullAccess(agent, input.checked))
    return h(
      'div',
      { class: 'tool-access' },
      h('label', { class: 'check', for: id }, input, 'Start with full access'),
      h('span', { class: 'hint' }, `Skips approval prompts (${FULL_ACCESS_FLAGS[agent]}). Applies to new sessions.`)
    )
  }

  private status(tool: ToolReport): HTMLElement {
    const state = toolState(tool)
    const flag =
      state === 'update'
        ? h('span', { class: 'tool-flag update' }, 'Update ready')
        : state === 'current'
          ? h('span', { class: 'tool-flag current' }, 'Up to date')
          : state === 'missing'
            ? h('span', { class: 'tool-flag muted' }, 'Not installed')
            : h('span', { class: 'tool-flag muted' }, 'Installed')
    return h('div', { class: 'tool-status', 'data-state': state }, flag)
  }

  private action(tool: ToolReport, command: ReturnType<typeof toolCommand>, node: NodeInfo): HTMLElement {
    const state = toolState(tool)
    const name = TOOL_NAMES[tool.agent]
    if (command.needsNode && nodeProblem(node)) {
      return h(
        'button',
        { class: 'tool-link node-link', type: 'button', onClick: () => void api.openExternal(NODE_DOWNLOAD_URL) },
        NODE_NOTE
      )
    }
    const [label, visible, primary] =
      state === 'missing'
        ? ['Install', 'Install', true]
        : state === 'update'
          ? ['Update', `Update to ${tool.latest}`, true]
          : state === 'current'
            ? ['Reinstall', 'Reinstall', false]
            : ['Update', 'Update', false]
    return h(
      'button',
      {
        class: `btn ${primary ? 'primary' : 'ghost'}`,
        type: 'button',
        'aria-label': `${label} ${name}`,
        onClick: () => void runAgentTask([tool.agent])
      },
      visible as string
    )
  }
}
