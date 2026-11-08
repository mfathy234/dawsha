import { AGENT_NAMES, AGENTS } from '../../shared/agents'
import { transportLine, type McpPublicEntry, type McpReport, type McpServer } from '../../shared/mcp'
import { api } from '../api'
import { h } from '../dom'
import { agentMark } from './agentMark'
import { toast } from './toast'
import './mcpPanel.css'

/** Settings > MCP: the servers each agent is set up with, read from the agents' own files. */
export class McpServersPanel {
  readonly el = h('div', { class: 'mcp-panel', id: 'mcp-panel' })
  private report: McpReport | null = null
  private state: 'idle' | 'loading' | 'failed' = 'idle'
  private started = false
  private readonly busy = new Set<string>()

  /** Loads the list the first time the section is shown. */
  activate(): void {
    if (this.started) return
    this.started = true
    void this.load()
  }

  private async load(): Promise<void> {
    this.state = 'loading'
    this.render()
    try {
      this.report = await api.mcp.list()
      this.state = 'idle'
    } catch {
      this.state = 'failed'
    }
    this.render()
  }

  private render(): void {
    const refresh = h('button', { class: 'btn ghost small', type: 'button', id: 'mcp-refresh', disabled: this.state === 'loading', onClick: () => void this.load() }, this.state === 'loading' ? 'Reading…' : 'Refresh')
    const head = h('div', { class: 'mcp-toolbar' }, refresh)
    if (!this.report) {
      this.el.replaceChildren(head, h('p', { class: 'hint', role: 'status' }, this.state === 'failed' ? 'The MCP servers could not be read.' : 'Reading the MCP files of your agents…'))
      return
    }
    const servers = this.report.servers
    this.el.replaceChildren(head, ...AGENTS.flatMap((agent) => this.agentBlock(agent, servers.filter((server) => server.agent === agent))))
  }

  private agentBlock(agent: (typeof AGENTS)[number], servers: McpServer[]): HTMLElement[] {
    const title = h('h3', { class: 'mcp-agent', 'data-agent': agent }, agentMark(agent), AGENT_NAMES[agent])
    if (servers.length === 0) return [title, h('p', { class: 'hint' }, 'No MCP servers set up.')]
    return [title, ...servers.map((server) => this.row(server))]
  }

  private row(server: McpServer): HTMLElement {
    const meta = h('div', { class: 'mcp-meta' }, h('span', {}, server.scopeLabel), server.enabled ? null : h('span', {}, 'Off'))
    const main = h('div', { class: 'set-main' }, h('div', { class: 'set-name' }, server.name), meta, h('p', { class: 'mcp-transport' }, transportLine(server.transport)), this.details(server))
    return h('div', { class: `set-row mcp-row${server.enabled ? '' : ' mcp-off'}`, 'data-server': server.id }, main, h('div', { class: 'set-control' }, this.control(server)))
  }

  private control(server: McpServer): HTMLElement {
    if (server.toggle === 'file') {
      return h('button', {
        class: 'toggle', type: 'button', role: 'switch', 'aria-label': `${server.name} on or off`, 'aria-checked': String(server.enabled),
        disabled: this.busy.has(server.id), onClick: () => void this.toggle(server)
      })
    }
    const open = h('button', { class: 'btn ghost small', type: 'button', onClick: () => void this.openFile(server) }, 'Open file')
    return h('div', { class: 'mcp-edit', title: server.note ?? '' }, 'Edit in file', open)
  }

  private details(server: McpServer): HTMLElement {
    const entries = server.entries.map((entry) => this.entry(server, entry))
    return h('details', { class: 'mcp-details' }, h('summary', {}, 'Details'), ...entries, server.note ? h('p', { class: 'hint' }, server.note) : null, h('pre', { class: 'mcp-raw' }, server.raw))
  }

  private entry(server: McpServer, entry: McpPublicEntry): HTMLElement {
    const value = h('span', {}, entry.value ?? '')
    if (entry.masked) {
      const reveal = h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Show ${entry.key}` }, '••••••••  Show')
      reveal.addEventListener('click', () => void this.reveal(server, entry, reveal, value))
      value.replaceChildren(reveal)
    }
    return h('div', { class: 'mcp-entry' }, h('span', { class: 'mcp-entry-key' }, `${entry.group === 'env' ? '' : 'header '}${entry.key}`), value)
  }

  private async reveal(server: McpServer, entry: McpPublicEntry, button: HTMLElement, value: HTMLElement): Promise<void> {
    const result = await api.mcp.reveal({ id: server.id, key: entry.key, group: entry.group }).catch(() => null)
    if (result?.ok) value.replaceChildren(result.value)
    else button.textContent = 'Not found'
  }

  private async toggle(server: McpServer): Promise<void> {
    this.busy.add(server.id)
    this.render()
    const result = await api.mcp.toggle({ id: server.id, enabled: !server.enabled }).catch(() => null)
    this.busy.delete(server.id)
    if (result?.ok) this.report = result.report
    else toast(result && !result.ok ? result.error : 'The server could not be switched.')
    this.render()
  }

  private async openFile(server: McpServer): Promise<void> {
    const result = await api.mcp.openFile({ id: server.id }).catch(() => null)
    if (!result?.ok) toast(result && !result.ok ? result.error : 'The file could not be opened.')
  }
}
