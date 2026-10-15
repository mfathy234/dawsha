import { stripAnsi } from './handoff'

export type TranscriptFormat = 'md' | 'html'

export type TranscriptEntry =
  | { kind: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; name: string; arg: string }

export interface ParsedSession {
  title?: string
  model?: string
  startedAt?: number
  endedAt?: number
  entries: TranscriptEntry[]
}

export interface TranscriptDoc {
  title: string
  agent: string
  model?: string
  project: string
  folder: string
  sessionId?: string
  startedAt?: number
  endedAt?: number
  entries: TranscriptEntry[]
  scrollback?: string
  changes?: string
}

export const TOOL_ARG_MAX = 120
export const TRANSCRIPT_MAX_BYTES = 64 * 1024 * 1024

const NO_SESSION_NOTE = 'Terminal text only: no session file was found for this tab.'
const EMPTY_NOTE = 'No messages in this session.'

export type Json = Record<string, unknown>

export const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const C1 = /[\u0080-\u009f]/g

export function cleanText(text: string): string {
  return stripAnsi(text).replace(C1, '')
}

export function flat(text: string, limit: number): string {
  const one = cleanText(text).replace(/\s+/g, ' ').trim()
  return one.length > limit ? `${one.slice(0, limit - 1)}…` : one
}

const ARG_KEYS = ['command', 'cmd', 'file_path', 'path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt', 'input']

export function toolArg(input: unknown): string {
  if (typeof input === 'string') return flat(input, TOOL_ARG_MAX)
  if (Array.isArray(input)) return flat(input.map(String).join(' '), TOOL_ARG_MAX)
  if (!isRecord(input)) return ''
  for (const key of ARG_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return flat(value, TOOL_ARG_MAX)
    if (Array.isArray(value) && value.length > 0) return flat(value.map(String).join(' '), TOOL_ARG_MAX)
  }
  const keys = Object.keys(input)
  return keys.length === 0 ? '' : flat(JSON.stringify(input), TOOL_ARG_MAX)
}

export function records(text: string): Json[] {
  const out: Json[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const value: unknown = JSON.parse(line)
      if (isRecord(value)) out.push(value)
    } catch {
      continue
    }
  }
  return out
}

export const asTime = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

class Span {
  startedAt?: number
  endedAt?: number

  note(value: number | undefined): void {
    if (value === undefined) return
    this.startedAt = this.startedAt === undefined ? value : Math.min(this.startedAt, value)
    this.endedAt = this.endedAt === undefined ? value : Math.max(this.endedAt, value)
  }
}

export function blockText(content: unknown, types: string[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!isRecord(part) || typeof part.text !== 'string') return ''
      return part.type === undefined || types.includes(String(part.type)) ? part.text : ''
    })
    .join('')
}

export const isPrompt = (text: string): boolean => text.trim() !== '' && !text.trim().startsWith('<')

function push(entries: TranscriptEntry[], kind: 'user' | 'assistant', text: string): void {
  const body = cleanText(text).trim()
  if (body !== '') entries.push({ kind, text: body })
}

function pushTool(entries: TranscriptEntry[], name: unknown, input: unknown): void {
  const label = flat(typeof name === 'string' && name !== '' ? name : 'tool', 60)
  entries.push({ kind: 'tool', name: label, arg: toolArg(input) })
}

export function parseClaudeSession(text: string): ParsedSession {
  const entries: TranscriptEntry[] = []
  const span = new Span()
  const session: ParsedSession = { entries }
  let custom: string | undefined
  let generated: string | undefined
  for (const record of records(text)) {
    span.note(asTime(record.timestamp))
    if (record.type === 'custom-title' && typeof record.customTitle === 'string') custom = record.customTitle
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') generated = record.aiTitle
    if (record.isSidechain === true) continue
    const message = isRecord(record.message) ? record.message : {}
    if (record.type === 'user' && record.isMeta !== true) {
      const prompt = blockText(message.content, ['text'])
      if (isPrompt(prompt)) push(entries, 'user', prompt)
    } else if (record.type === 'assistant') {
      if (typeof message.model === 'string' && message.model !== '<synthetic>') session.model = message.model
      const content = message.content
      if (typeof content === 'string') push(entries, 'assistant', content)
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (!isRecord(part)) continue
          if (part.type === 'text' && typeof part.text === 'string') push(entries, 'assistant', part.text)
          else if (part.type === 'tool_use') pushTool(entries, part.name, part.input)
        }
      }
    }
  }
  const title = (custom?.trim() || generated?.trim()) ?? ''
  if (title) session.title = flat(title, 120)
  session.startedAt = span.startedAt
  session.endedAt = span.endedAt
  return session
}

export function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function codexTool(payload: Json): { name: unknown; input: unknown } | null {
  if (payload.type === 'function_call') return { name: payload.name, input: parseJson(payload.arguments) }
  if (payload.type === 'custom_tool_call') return { name: payload.name, input: payload.input }
  if (payload.type === 'local_shell_call') {
    const action = isRecord(payload.action) ? payload.action : {}
    return { name: 'shell', input: { command: action.command } }
  }
  return null
}

export function parseCodexSession(text: string): ParsedSession {
  const all = records(text)
  const hasEvents = all.some(
    (r) => r.type === 'event_msg' && isRecord(r.payload) && (r.payload.type === 'user_message' || r.payload.type === 'agent_message')
  )
  const entries: TranscriptEntry[] = []
  const span = new Span()
  const session: ParsedSession = { entries }
  for (const record of all) {
    const payload = isRecord(record.payload) ? record.payload : {}
    span.note(asTime(record.timestamp))
    if (record.type === 'session_meta') span.note(asTime(payload.timestamp))
    if (record.type === 'turn_context' && typeof payload.model === 'string') session.model = payload.model
    if (record.type === 'event_msg' && hasEvents && typeof payload.message === 'string') {
      if (payload.type === 'user_message' && isPrompt(payload.message)) push(entries, 'user', payload.message)
      if (payload.type === 'agent_message') push(entries, 'assistant', payload.message)
    }
    if (record.type !== 'response_item') continue
    if (payload.type === 'message' && !hasEvents) {
      const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : null
      const body = blockText(payload.content, ['input_text', 'output_text'])
      if (role && (role === 'assistant' || isPrompt(body))) push(entries, role, body)
    }
    const tool = codexTool(payload)
    if (tool) pushTool(entries, tool.name, tool.input)
  }
  session.startedAt = span.startedAt
  session.endedAt = span.endedAt
  return session
}

export function geminiMessages(text: string): { messages: Json[]; summary?: string; startedAt?: number; updatedAt?: number } {
  const order: string[] = []
  const byId = new Map<string, Json>()
  const anonymous: Json[] = []
  const out: { summary?: string; startedAt?: number; updatedAt?: number } = {}
  const take = (message: Json): void => {
    if (typeof message.id === 'string') {
      if (!byId.has(message.id)) order.push(message.id)
      byId.set(message.id, message)
    } else {
      anonymous.push(message)
    }
  }
  const meta = (record: Json): void => {
    if (typeof record.summary === 'string' && record.summary.trim()) out.summary = record.summary
    out.startedAt ??= asTime(record.startTime)
    const updated = asTime(record.lastUpdated)
    if (updated !== undefined) out.updatedAt = Math.max(out.updatedAt ?? 0, updated)
  }
  const single = text.trim().startsWith('{') && !text.trim().includes('\n')
  const lines = single ? [text.trim()] : text.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(record)) continue
    if (isRecord(record.$set)) meta(record.$set)
    else if (typeof record.id === 'string' && typeof record.type === 'string') take(record)
    else if (typeof record.sessionId === 'string') {
      meta(record)
      if (Array.isArray(record.messages)) for (const m of record.messages) if (isRecord(m)) take(m)
    }
  }
  const messages = [...order.map((id) => byId.get(id) as Json), ...anonymous]
  return { messages, ...out }
}

export function parseGeminiSession(text: string): ParsedSession {
  const { messages, summary, startedAt, updatedAt } = geminiMessages(text)
  const entries: TranscriptEntry[] = []
  const span = new Span()
  const session: ParsedSession = { entries }
  span.note(startedAt)
  span.note(updatedAt)
  for (const message of messages) {
    span.note(asTime(message.timestamp))
    const body = blockText(message.content, ['text']).trim()
    if (message.type === 'user' && body && !body.startsWith('/') && !body.startsWith('?')) push(entries, 'user', body)
    if (message.type !== 'gemini') continue
    if (typeof message.model === 'string' && message.model) session.model = message.model
    if (body) push(entries, 'assistant', body)
    if (Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) if (isRecord(call)) pushTool(entries, call.displayName ?? call.name, call.args)
    }
  }
  if (summary) session.title = flat(summary, 120)
  session.startedAt = span.startedAt
  session.endedAt = span.endedAt
  return session
}

export interface Turn {
  role: 'user' | 'assistant'
  items: TranscriptEntry[]
}

export function groupTurns(entries: TranscriptEntry[]): Turn[] {
  const turns: Turn[] = []
  for (const entry of entries) {
    const role = entry.kind === 'user' ? 'user' : 'assistant'
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.items.push(entry)
    else turns.push({ role, items: [entry] })
  }
  return turns
}

export function formatStamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const ONE_LINE = (value: string): string => value.replace(/\s+/g, ' ').trim()

function metaRows(doc: TranscriptDoc): [string, string][] {
  const rows: [string, string | undefined][] = [
    ['Agent', doc.agent],
    ['Model', doc.model],
    ['Project', doc.project],
    ['Folder', doc.folder],
    ['Started', doc.startedAt === undefined ? undefined : formatStamp(doc.startedAt)],
    ['Last activity', doc.endedAt === undefined ? undefined : formatStamp(doc.endedAt)],
    ['Session', doc.sessionId]
  ]
  const known = rows.filter((row): row is [string, string] => Boolean(row[1]))
  const mapped = known.map(([label, value]): [string, string] => [label, ONE_LINE(cleanText(value))])
  return doc.scrollback === undefined ? mapped : [...mapped, ['Source', NO_SESSION_NOTE]]
}

function fence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const ticks = '`'.repeat(longest + 1)
  return longest > 0 ? `${ticks} ${text} ${ticks}` : `${ticks}${text}${ticks}`
}

function closeFences(text: string): string {
  const opened = text.split('\n').filter((line) => /^\s*```/.test(line)).length
  return opened % 2 === 1 ? `${text}\n\`\`\`` : text
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

function block(title: string, body: string): string {
  const mark = fence(body)
  return `## ${title}\n\n${mark}\n${body}\n${mark}`
}

function trimScrollback(text: string): string {
  return cleanText(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

function markdownTurn(turn: Turn): string {
  const parts: string[] = [`### ${turn.role === 'user' ? 'User' : 'Assistant'}`]
  let tools: string[] = []
  const flush = (): void => {
    if (tools.length > 0) parts.push(tools.join('\n'))
    tools = []
  }
  for (const item of turn.items) {
    if (item.kind === 'tool') {
      tools.push(`- **${item.name.replace(/[*_`]/g, '')}**${item.arg ? ` ${codeSpan(item.arg)}` : ''}`)
      continue
    }
    flush()
    parts.push(item.kind === 'user' ? quote(item.text) : closeFences(item.text))
  }
  flush()
  return parts.join('\n\n')
}

export function renderMarkdown(doc: TranscriptDoc): string {
  const out: string[] = [`# ${ONE_LINE(cleanText(doc.title)) || 'Transcript'}`]
  out.push(metaRows(doc).map(([label, value]) => `- **${label}:** ${value}`).join('\n'))
  if (doc.scrollback !== undefined) {
    const text = trimScrollback(doc.scrollback)
    out.push(text === '' ? `_${EMPTY_NOTE}_` : block('Terminal output', text))
  } else if (doc.entries.length === 0) {
    out.push(`_${EMPTY_NOTE}_`)
  } else {
    out.push('## Conversation', ...groupTurns(doc.entries).map(markdownTurn))
  }
  const changes = doc.changes ? trimScrollback(doc.changes) : ''
  if (changes !== '') out.push(block('Changes', changes))
  return `${out.join('\n\n')}\n`
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const HTML_STYLE = `:root{color-scheme:light dark;--bg:#fff;--fg:#1d2127;--muted:#5d6672;--line:#d9dee5;--panel:#f4f6f9;--user:#e8f0fe;--accent:#3157b8}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e3e7ec;--muted:#98a2af;--line:#2b313a;--panel:#1c2027;--user:#1f2b44;--accent:#8aa9f2}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:1.5rem;margin:0 0 16px}
h2{font-size:1.05rem;margin:32px 0 12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
h3{font-size:.8rem;margin:0 0 6px;color:var(--accent);text-transform:uppercase;letter-spacing:.06em}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0;padding:12px 16px;background:var(--panel);border:1px solid var(--line);border-radius:8px}
dt{color:var(--muted)}
dd{margin:0;overflow-wrap:anywhere}
.turn{margin:18px 0;padding:12px 16px;border:1px solid var(--line);border-radius:8px}
.turn.user{background:var(--user)}
.text,pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 8px;font:inherit}
pre{font:13px/1.45 ui-monospace,Consolas,monospace;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto}
.tool{margin:2px 0;color:var(--muted);font:13px/1.4 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}
.tool b{color:var(--fg)}
.note{color:var(--muted);font-style:italic}`

function htmlTurn(turn: Turn): string {
  const label = turn.role === 'user' ? 'User' : 'Assistant'
  const body = turn.items
    .map((item) =>
      item.kind === 'tool'
        ? `<p class="tool"><b>${escapeHtml(item.name)}</b>${item.arg ? ` ${escapeHtml(item.arg)}` : ''}</p>`
        : `<p class="text">${escapeHtml(item.text)}</p>`
    )
    .join('\n')
  return `<section class="turn ${turn.role}">\n<h3>${label}</h3>\n${body}\n</section>`
}

export function renderHtml(doc: TranscriptDoc): string {
  const title = ONE_LINE(cleanText(doc.title)) || 'Transcript'
  const rows = metaRows(doc)
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('\n')
  const body: string[] = []
  if (doc.scrollback !== undefined) {
    const text = trimScrollback(doc.scrollback)
    body.push(text === '' ? `<p class="note">${EMPTY_NOTE}</p>` : `<h2>Terminal output</h2>\n<pre>${escapeHtml(text)}</pre>`)
  } else if (doc.entries.length === 0) {
    body.push(`<p class="note">${EMPTY_NOTE}</p>`)
  } else {
    body.push('<h2>Conversation</h2>', ...groupTurns(doc.entries).map(htmlTurn))
  }
  const changes = doc.changes ? trimScrollback(doc.changes) : ''
  if (changes !== '') body.push(`<h2>Changes</h2>\n<pre>${escapeHtml(changes)}</pre>`)
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${HTML_STYLE}\n</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escapeHtml(title)}</h1>`,
    `<dl>\n${rows}\n</dl>`,
    ...body,
    '</main>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

export const renderTranscript = (doc: TranscriptDoc, format: TranscriptFormat): string =>
  format === 'html' ? renderHtml(doc) : renderMarkdown(doc)

const ILLEGAL_NAME = /[<>:"/\\|?*\u0000-\u001f]+/g

export function sanitizeNamePart(text: string, limit: number): string {
  const cleaned = cleanText(text)
    .replace(ILLEGAL_NAME, ' ')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned.slice(0, limit).replace(/[-.]+$/, '')
}

const two = (value: number): string => String(value).padStart(2, '0')

export const localDate = (now: Date): string => `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`

export function transcriptFileName(input: {
  project: string
  title?: string
  agent: string
  now: Date
  format: TranscriptFormat
}): string {
  const parts = [
    sanitizeNamePart(input.project, 40),
    sanitizeNamePart(input.title ?? '', 50) || sanitizeNamePart(input.agent, 20),
    localDate(input.now)
  ].filter((part) => part !== '')
  return `${parts.join('-')}.${input.format}`
}

export const formatFromPath = (path: string): TranscriptFormat => (/\.html?$/i.test(path) ? 'html' : 'md')

export interface TranscriptRequest {
  agent: 'claude' | 'codex' | 'gemini' | 'shell'
  agentLabel: string
  sessionId?: string
  folder: string
  projectName: string
  title?: string
  scrollback?: string
}

export type TranscriptResult =
  | { status: 'saved'; path: string; source: 'session' | 'scrollback' }
  | { status: 'cancelled' }
  | { status: 'no-session' }
  | { status: 'error'; message: string }
