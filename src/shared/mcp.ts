import type { AgentKind } from './types'
import { isSecretConfig, secretValueShape } from './configSecrets'

export const MASK = '••••••••'

export type McpTransport =
  | { kind: 'stdio'; command: string; args: string[] }
  | { kind: 'url'; url: string; type: string | null }
  | { kind: 'unknown' }

export interface McpEntry {
  key: string
  group: 'env' | 'headers'
  value: string
}

/** A server as read from its file. Secret values are still in it, so it never leaves the main process. */
export interface McpServerFull {
  id: string
  agent: AgentKind
  name: string
  scope: 'user' | 'project'
  scopeLabel: string
  /** The file the server is defined in. */
  file: string
  transport: McpTransport
  entries: McpEntry[]
  /** The server's entry as JSON text (a TOML table is shown as the JSON of what was read from it). */
  rawText: string
  enabled: boolean
  /** "file": Dawsha can switch it. "readonly": the user edits the file. */
  toggle: 'file' | 'readonly'
  note: string | null
}

export interface McpPublicEntry {
  key: string
  group: 'env' | 'headers'
  /** Null when the value is masked: it is only fetched when the user asks. */
  value: string | null
  masked: boolean
}

export interface McpServer extends Omit<McpServerFull, 'entries' | 'rawText'> {
  entries: McpPublicEntry[]
  /** The server's text with secret values replaced. */
  raw: string
}

export type McpReport = { servers: McpServer[] }
export type McpActionResult = { ok: true; report: McpReport } | { ok: false; error: string }
export type McpRevealResult = { ok: true; value: string } | { ok: false; error: string }
export type McpOpenResult = { ok: true } | { ok: false; error: string }

export const MCP_IPC = {
  list: 'mcp:list',
  toggle: 'mcp:toggle',
  reveal: 'mcp:reveal',
  openFile: 'mcp:open-file'
} as const

export interface McpApi {
  list(): Promise<McpReport>
  toggle(request: { id: string; enabled: boolean }): Promise<McpActionResult>
  reveal(request: { id: string; key: string; group: 'env' | 'headers' }): Promise<McpRevealResult>
  openFile(request: { id: string }): Promise<McpOpenResult>
}

const SECRET_FLAG = /^--?[\w-]*(key|token|secret|password|passwd|auth)[\w-]*$/i
const SECRET_FLAG_VALUE = /^(--?[\w-]*(?:key|token|secret|password|passwd|auth)[\w-]*)=(.+)$/i

/** Arguments with secrets replaced: `--token=x`, the value after `--token`, and values shaped like credentials. */
export function maskArgs(args: readonly string[]): string[] {
  return args.map((arg, index) => {
    const inline = SECRET_FLAG_VALUE.exec(arg)
    if (inline) return `${inline[1]}=${MASK}`
    if (index > 0 && SECRET_FLAG.test(args[index - 1])) return MASK
    return secretValueShape(arg) ? MASK : arg
  })
}

/** A URL with credentials and secret query values replaced. */
export function maskUrl(url: string): string {
  return url
    .replace(/(:\/\/)[^/\s@]*@/, `$1${MASK}@`)
    .replace(/([?&])([^=&#]+)=([^&#]*)/g, (all, sep: string, key: string, value: string) => (isSecretConfig(safeDecode(key), safeDecode(value)) ? `${sep}${key}=${MASK}` : all))
}

const safeDecode = (text: string): string => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function maskValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    if (key === 'url' || key === 'httpUrl') return maskUrl(value)
    return isSecretConfig(key, value) ? MASK : value
  }
  if (Array.isArray(value)) return key === 'args' ? maskArgs(value.map(String)) : value.map((item) => maskValue(key, item))
  if (value && typeof value === 'object') return maskObject(value as Record<string, unknown>)
  return value
}

function maskObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskValue(key, item)]))
}

/** Pretty JSON of a server entry with every secret value replaced. */
export function maskedJson(entry: unknown): string {
  const masked = entry && typeof entry === 'object' && !Array.isArray(entry) ? maskObject(entry as Record<string, unknown>) : entry
  return JSON.stringify(masked, null, 2)
}

export function maskTransport(transport: McpTransport): McpTransport {
  if (transport.kind === 'stdio') return { ...transport, args: maskArgs(transport.args) }
  return transport.kind === 'url' ? { ...transport, url: maskUrl(transport.url) } : transport
}

/** The renderer's view of a server: nothing secret in it. */
export function publicServer(server: McpServerFull): McpServer {
  const { entries, rawText, ...rest } = server
  return {
    ...rest,
    transport: maskTransport(server.transport),
    entries: entries.map((entry) => {
      const masked = isSecretConfig(entry.key, entry.value)
      return { key: entry.key, group: entry.group, value: masked ? null : entry.value, masked }
    }),
    raw: maskJsonText(rawText)
  }
}

function maskJsonText(text: string): string {
  try {
    return maskedJson(JSON.parse(text))
  } catch {
    return ''
  }
}

/** One line for a transport: the command with its arguments, or the URL with its type. */
export function transportLine(transport: McpTransport): string {
  if (transport.kind === 'stdio') return [transport.command, ...transport.args].join(' ')
  if (transport.kind === 'url') return transport.type ? `${transport.url} (${transport.type})` : transport.url
  return 'Unknown transport'
}
