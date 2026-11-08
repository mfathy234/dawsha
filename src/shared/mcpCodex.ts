import type { McpEntry, McpServerFull, McpTransport } from './mcp'
import { parseToml, type TomlItem, type TomlValue } from './mcpToml'

type Table = { [key: string]: TomlValue }

const isTable = (value: unknown): value is Table => typeof value === 'object' && value !== null && !Array.isArray(value)
const HEADER_TABLES = new Set(['http_headers', 'env_http_headers'])

/** The `[mcp_servers.<name>]` tables of a Codex config.toml, each folded into one object with its sub-tables. */
function serverTables(items: readonly TomlItem[]): Map<string, Table> {
  const servers = new Map<string, Table>()
  for (const item of items) {
    if (item.path[0] !== 'mcp_servers' || item.path.length < 2) continue
    const name = item.path[1]
    const current = servers.get(name) ?? {}
    if (item.kind === 'table') {
      servers.set(name, item.path.length > 2 && !isTable(current[item.path[2]]) ? { ...current, [item.path[2]]: {} } : current)
    } else if (item.path.length === 2) {
      servers.set(name, { ...current, [item.key]: item.value })
    } else {
      const sub = isTable(current[item.path[2]]) ? (current[item.path[2]] as Table) : {}
      servers.set(name, { ...current, [item.path[2]]: { ...sub, [item.key]: item.value } })
    }
  }
  return servers
}

function entriesOf(table: Table): McpEntry[] {
  const groups: Array<[string, McpEntry['group']]> = [['env', 'env'], ...[...HEADER_TABLES].map((key): [string, McpEntry['group']] => [key, 'headers'])]
  return groups.flatMap(([key, group]) => {
    const sub = table[key]
    return isTable(sub) ? Object.entries(sub).map(([name, value]) => ({ key: name, group, value: String(value) })) : []
  })
}

function transportOf(table: Table): McpTransport {
  if (typeof table.command === 'string') {
    const args = Array.isArray(table.args) ? table.args.map(String) : []
    return { kind: 'stdio', command: table.command, args }
  }
  return typeof table.url === 'string' ? { kind: 'url', url: table.url, type: null } : { kind: 'unknown' }
}

/** Codex's MCP servers. `enabled = false` in a table switches one off. */
export function listCodexServers(text: string, file: string): McpServerFull[] {
  return [...serverTables(parseToml(text))].map(([name, table]) => ({
    id: `codex:user:${name}`,
    agent: 'codex',
    name,
    scope: 'user',
    scopeLabel: 'User',
    file,
    transport: transportOf(table),
    entries: entriesOf(table),
    rawText: JSON.stringify(table),
    enabled: table.enabled !== false,
    toggle: 'file',
    note: null
  }))
}

/** The text with `enabled` set in the server's own table, touching nothing else; null when the server is not there. */
export function setCodexEnabled(text: string, name: string, enabled: boolean): string | null {
  const items = parseToml(text)
  const own = (item: TomlItem): boolean => item.path.length === 2 && item.path[0] === 'mcp_servers' && item.path[1] === name
  const header = items.find((item) => item.kind === 'table' && own(item))
  if (!header) return null
  const lines = text.split('\n')
  const existing = items.find((item) => item.kind === 'kv' && own(item) && item.key === 'enabled')
  if (existing) {
    lines[existing.line] = lines[existing.line].replace(/^(\s*enabled\s*=\s*)(true|false)/, `$1${enabled}`)
  } else if (!enabled) {
    lines.splice(header.line + 1, 0, `enabled = false${text.includes('\r\n') ? '\r' : ''}`)
  }
  return lines.join('\n')
}
