import type { AgentKind } from './types'
import type { McpEntry, McpServerFull, McpTransport } from './mcp'

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A folder path in one spelling, so C:\code\app\ and C:/code/app match. */
export const normalPath = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Removes comments and trailing commas outside strings. */
function stripJsonExtras(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 1
    } else out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** The parsed JSON, also when it has comments or trailing commas; undefined when it cannot be read. */
export function parseJsonLoose(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    try {
      return JSON.parse(stripJsonExtras(text))
    } catch {
      return undefined
    }
  }
}

function transportOf(entry: Json): McpTransport {
  const type = typeof entry.type === 'string' ? entry.type : null
  if (typeof entry.httpUrl === 'string') return { kind: 'url', url: entry.httpUrl, type: 'http' }
  if (typeof entry.url === 'string') return { kind: 'url', url: entry.url, type }
  if (typeof entry.command === 'string') return { kind: 'stdio', command: entry.command, args: Array.isArray(entry.args) ? entry.args.map(String) : [] }
  return { kind: 'unknown' }
}

function entriesOf(entry: Json): McpEntry[] {
  const pick = (value: unknown, group: McpEntry['group']): McpEntry[] =>
    isObject(value) ? Object.entries(value).map(([key, item]) => ({ key, group, value: String(item) })) : []
  return [...pick(entry.env, 'env'), ...pick(entry.headers, 'headers')]
}

interface Source {
  agent: AgentKind
  /** Part of the id: which map of which file. */
  key: string
  scope: McpServerFull['scope']
  scopeLabel: string
  file: string
  toggle: McpServerFull['toggle']
  note: string | null
}

function serversOf(source: Source, map: unknown, disabled: ReadonlySet<string>): McpServerFull[] {
  if (!isObject(map)) return []
  const { key, ...rest } = source
  return Object.entries(map).map(([name, raw]) => {
    const entry = isObject(raw) ? raw : {}
    return {
      ...rest,
      id: `${source.agent}:${key}:${name}`,
      name,
      transport: transportOf(entry),
      entries: entriesOf(entry),
      rawText: JSON.stringify(raw ?? null),
      enabled: !disabled.has(name)
    }
  })
}

export interface ClaudeProjectFiles {
  name: string
  folder: string
  /** Text of the project's .mcp.json, or null when it has none. */
  mcpJsonText: string | null
}

const USER_NOTE = 'Claude Code turns user servers off per project. Edit the file to remove one.'
const FILE_NOTE = 'Servers from .mcp.json are approved or rejected inside Claude Code. Edit the file to change one.'

function projectServers(file: string, project: ClaudeProjectFiles, known: Json): McpServerFull[] {
  const id = normalPath(project.folder)
  const found = Object.entries(known).find(([path]) => normalPath(path) === id)?.[1]
  const entry = isObject(found) ? found : {}
  const disabled = new Set(Array.isArray(entry.disabledMcpServers) ? entry.disabledMcpServers.map(String) : [])
  const local: Source = { agent: 'claude', key: `local:${id}`, scope: 'project', scopeLabel: project.name, file, toggle: 'file', note: null }
  const shared: Source = { agent: 'claude', key: `mcpjson:${id}`, scope: 'project', scopeLabel: `${project.name} (.mcp.json)`, file: `${project.folder}/.mcp.json`, toggle: 'readonly', note: FILE_NOTE }
  const parsed = parseJsonLoose(project.mcpJsonText)
  return [...serversOf(local, entry.mcpServers, disabled), ...serversOf(shared, isObject(parsed) ? parsed.mcpServers : undefined, new Set())]
}

/** Claude Code's servers: user scope and per-project local scope from ~/.claude.json, and each project's .mcp.json. Only Dawsha's projects are listed. */
export function claudeServers(input: { file: string; userText: string | null; projects: readonly ClaudeProjectFiles[] }): McpServerFull[] {
  const root = parseJsonLoose(input.userText)
  const top = isObject(root) ? root : {}
  const known = isObject(top.projects) ? top.projects : {}
  const userSource: Source = { agent: 'claude', key: 'user', scope: 'user', scopeLabel: 'User', file: input.file, toggle: 'readonly', note: USER_NOTE }
  return [...serversOf(userSource, top.mcpServers, new Set()), ...input.projects.flatMap((project) => projectServers(input.file, project, known))]
}

/** Gemini CLI's servers from ~/.gemini/settings.json. Gemini has its own allow and exclude lists, so Dawsha only shows them. */
export function geminiServers(file: string, text: string | null): McpServerFull[] {
  const root = parseJsonLoose(text)
  const note = 'Gemini CLI controls servers with its own settings. Edit the file to change one.'
  const source: Source = { agent: 'gemini', key: 'user', scope: 'user', scopeLabel: 'User', file, toggle: 'readonly', note }
  return serversOf(source, isObject(root) ? root.mcpServers : undefined, new Set())
}

function indentOf(text: string): string | number {
  const match = /\n([ \t]+)"/.exec(text)
  return match ? match[1] : text.includes('\n') ? 2 : 0
}

/** ~/.claude.json with the server's name added to or removed from the project's disabledMcpServers (the list Claude Code's /mcp panel writes). Null when the project or server is not in the file. */
export function setClaudeLocalEnabled(text: string, folder: string, name: string, enabled: boolean): string | null {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(root) || !isObject(root.projects)) return null
  const id = normalPath(folder)
  const path = Object.keys(root.projects).find((key) => normalPath(key) === id)
  const project = path === undefined ? undefined : root.projects[path]
  if (path === undefined || !isObject(project) || !isObject(project.mcpServers) || !(name in project.mcpServers)) return null
  const current = Array.isArray(project.disabledMcpServers) ? project.disabledMcpServers.map(String) : []
  if (current.includes(name) === !enabled) return text
  const next = enabled ? current.filter((item) => item !== name) : [...current, name]
  const { disabledMcpServers: _old, ...others } = project
  const changed = next.length > 0 ? { ...project, disabledMcpServers: next } : others
  const rebuilt = { ...root, projects: { ...root.projects, [path]: changed } }
  return JSON.stringify(rebuilt, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : '')
}
