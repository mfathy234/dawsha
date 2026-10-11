import type { GeminiSession } from './types'

const NAME_MAX = 100
const CHAT_FILE = /^session-.*\.jsonl?$/i

export interface GeminiChat {
  sessionId: string
  startedAt: number
  updatedAt: number
  name?: string
  model?: string
  hasConversation: boolean
  recentTools: { name: string; at: number }[]
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const asTime = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const isGeminiChatFile = (fileName: string): boolean => CHAT_FILE.test(fileName)

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('')
}

export function cleanGeminiText(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').replace(/[^\x20-\x7E]+/g, '').trim()
  return cleaned.length > NAME_MAX ? `${cleaned.slice(0, NAME_MAX - 3)}...` : cleaned
}

interface Accumulator {
  sessionId?: string
  startedAt?: number
  updatedAt?: number
  summary?: string
  firstUser?: string
  model?: string
  sawMessage: boolean
  recentTools: { name: string; at: number }[]
}

function takeMetadata(acc: Accumulator, meta: Json): void {
  if (typeof meta.sessionId === 'string') acc.sessionId = meta.sessionId
  const started = asTime(meta.startTime)
  if (started !== undefined && acc.startedAt === undefined) acc.startedAt = started
  const updated = asTime(meta.lastUpdated)
  if (updated !== undefined) acc.updatedAt = Math.max(acc.updatedAt ?? 0, updated)
  if (typeof meta.summary === 'string' && meta.summary.trim()) acc.summary = meta.summary
}

function takeMessage(acc: Accumulator, message: Json): void {
  acc.sawMessage = true
  if (message.type === 'user' && acc.firstUser === undefined) {
    const text = contentText(message.content).trim()
    if (text && !text.startsWith('/') && !text.startsWith('?')) acc.firstUser = text
  }
  if (message.type === 'gemini' && typeof message.model === 'string' && message.model) acc.model = message.model
  if (message.type === 'gemini' && Array.isArray(message.toolCalls)) {
    const at = asTime(message.timestamp) ?? acc.updatedAt ?? Date.now()
    for (const call of message.toolCalls) {
      if (!isRecord(call) || typeof call.name !== 'string' || !call.name.trim()) continue
      acc.recentTools.push({ name: call.name.slice(0, 80), at })
    }
    acc.recentTools = acc.recentTools.slice(-8)
  }
}

function takeRecord(acc: Accumulator, record: Json): void {
  if (isRecord(record.$set)) return takeMetadata(acc, record.$set)
  if (typeof record.id === 'string' && typeof record.type === 'string') return takeMessage(acc, record)
  if (typeof record.sessionId === 'string') {
    takeMetadata(acc, record)
    if (Array.isArray(record.messages)) for (const m of record.messages) if (isRecord(m)) takeMessage(acc, m)
  }
}

function finish(acc: Accumulator): GeminiChat | null {
  if (!acc.sessionId) return null
  const startedAt = acc.startedAt ?? acc.updatedAt ?? 0
  const name = acc.summary ? cleanGeminiText(acc.summary) : acc.firstUser ? cleanGeminiText(acc.firstUser) : undefined
  return {
    sessionId: acc.sessionId,
    startedAt,
    updatedAt: acc.updatedAt ?? startedAt,
    name: name || undefined,
    model: acc.model,
    hasConversation: acc.sawMessage,
    recentTools: acc.recentTools
  }
}

export function parseGeminiChat(text: string): GeminiChat | null {
  const acc: Accumulator = { sawMessage: false, recentTools: [] }
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && !trimmed.includes('\n')) {
    try {
      const whole: unknown = JSON.parse(trimmed)
      if (isRecord(whole)) takeRecord(acc, whole)
      return finish(acc)
    } catch {
      return null
    }
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const record: unknown = JSON.parse(line)
      if (isRecord(record)) takeRecord(acc, record)
    } catch {
      continue
    }
  }
  return finish(acc)
}

export function parseLegacyGeminiChat(text: string): GeminiChat | null {
  try {
    const whole: unknown = JSON.parse(text)
    if (!isRecord(whole)) return null
    const acc: Accumulator = { sawMessage: false, recentTools: [] }
    takeRecord(acc, whole)
    return finish(acc)
  } catch {
    return null
  }
}

export function toGeminiSession(chat: GeminiChat, modifiedAt: number): GeminiSession {
  return {
    sessionId: chat.sessionId,
    name: chat.name,
    startedAt: chat.startedAt,
    updatedAt: Math.max(chat.updatedAt, Math.round(modifiedAt)),
    model: chat.model,
    recentTools: chat.recentTools
  }
}

export function matchGeminiSessions(
  terms: { id: string; sessionId?: string }[],
  sessions: GeminiSession[]
): Map<string, GeminiSession> {
  const result = new Map<string, GeminiSession>()
  for (const term of terms) {
    const hit = term.sessionId ? sessions.find((s) => s.sessionId === term.sessionId) : undefined
    if (hit) result.set(term.id, hit)
  }
  return result
}

export const GEMINI_BUSY_MS = 2500

export function ptyStatus(lastOutputAt: number | undefined, now: number): 'busy' | 'idle' {
  return lastOutputAt !== undefined && now - lastOutputAt < GEMINI_BUSY_MS ? 'busy' : 'idle'
}
