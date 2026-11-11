import type { ChatItem, ChatTool } from './chatLog'
import type { ToolKind } from './chatKind'
import { turnSummaries } from './turnSummary'

/** What the phone's Chat tab is allowed to receive: short text only, never markup, output or paths beyond a file name. */
export const REMOTE_CHAT_ITEMS_MAX = 120
export const REMOTE_CHAT_TEXT_MAX = 4000
export const REMOTE_CHAT_TARGET_MAX = 160
export const REMOTE_CHAT_SEND_MAX = 4000
export const REMOTE_CHAT_SENDS_PER_MINUTE = 20
export const REMOTE_CHAT_READ_ONLY = 'Read only. Turn on “Terminal input” for this browser in Dawsha\'s Settings › Remote Access to send messages.'
export const REMOTE_CHAT_AGENTS = ['claude', 'codex'] as const

export type RemoteChatItem =
  | { k: 'you' | 'say'; id: string; text: string }
  | { k: 'tool'; id: string; kind: ToolKind; verb: string; target: string; add?: number; del?: number; failed?: boolean; done: boolean }
  | { k: 'note'; id: string; text: string }
  | { k: 'sum'; id: string; files: number; add: number; del: number }

export type RemoteChatPayload =
  | { status: 'ok'; version: string; earlier: number; items: RemoteChatItem[] }
  | { status: 'unchanged' }
  | { status: 'none' }
  | { status: 'failed'; reason: string }

export type SendCheck = { ok: true; id: string; text: string } | { ok: false; error: string }

const CONTROL = new RegExp('[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]', 'g')
const TERMINAL_ID = /^[a-zA-Z0-9_-]{1,128}$/

export const isTerminalId = (value: unknown): value is string => typeof value === 'string' && TERMINAL_ID.test(value)

export const isRemoteChatAgent = (agent: unknown): agent is (typeof REMOTE_CHAT_AGENTS)[number] => agent === 'claude' || agent === 'codex'

/** Text for display: control characters dropped, cut to a length. Newlines and tabs stay. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(CONTROL, '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000) : 0)

function toolItem(tool: ChatTool): RemoteChatItem {
  const add = count(tool.added)
  const del = count(tool.removed)
  return {
    k: 'tool',
    id: cleanText(tool.id, 80),
    kind: tool.activity,
    verb: cleanText(tool.verb, 40),
    target: cleanText(tool.target, REMOTE_CHAT_TARGET_MAX).replace(/\s+/g, ' '),
    ...(add ? { add } : {}),
    ...(del ? { del } : {}),
    ...(tool.failed ? { failed: true } : {}),
    done: tool.done
  }
}

function lineFor(item: ChatItem): RemoteChatItem | null {
  if (item.kind === 'message') {
    const text = cleanText(item.text, REMOTE_CHAT_TEXT_MAX)
    return text.trim() === '' ? null : { k: item.role === 'user' ? 'you' : 'say', id: cleanText(item.id, 80), text }
  }
  if (item.kind === 'tool') return toolItem(item)
  const text = cleanText(item.text, 200)
  return text.trim() === '' ? null : { k: 'note', id: cleanText(item.id, 80), text }
}

/** The parsed desktop chat as the compact text-only shape the phone draws: the newest items, a one-line row per tool call, and the reply summary after each reply. */
export function toRemoteChat(items: readonly ChatItem[], version: string, earlier: number): RemoteChatPayload {
  const summaries = new Map(turnSummaries(items).map((summary) => [summary.messageId, summary]))
  const lines: RemoteChatItem[] = []
  for (const item of items) {
    const line = lineFor(item)
    if (line) lines.push(line)
    const summary = item.kind === 'message' ? summaries.get(item.id) : undefined
    if (summary) lines.push({ k: 'sum', id: `${cleanText(item.id, 80)}:sum`, files: summary.files.length, add: summary.added, del: summary.removed })
  }
  const kept = lines.slice(-REMOTE_CHAT_ITEMS_MAX)
  return { status: 'ok', version: cleanText(version, 200), earlier: Math.max(0, Math.floor(earlier) || 0) + (lines.length - kept.length), items: kept }
}

/** One line for the terminal: line breaks become spaces so a message is sent as typed text, then Enter. */
export function flattenMessage(text: string): string {
  return text.replace(CONTROL, '').replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

/** Validates a send request from the phone. Runs in main on every send. */
export function checkChatSend(body: unknown): SendCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid message.' }
  const record = body as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'id' && key !== 'text')) return { ok: false, error: 'Invalid message.' }
  if (!isTerminalId(record.id)) return { ok: false, error: 'Invalid session.' }
  if (typeof record.text !== 'string') return { ok: false, error: 'Invalid message.' }
  if (record.text.length > REMOTE_CHAT_SEND_MAX) return { ok: false, error: `Messages can be up to ${REMOTE_CHAT_SEND_MAX} characters.` }
  const text = flattenMessage(record.text)
  if (text === '') return { ok: false, error: 'Type a message first.' }
  return { ok: true, id: record.id, text }
}
