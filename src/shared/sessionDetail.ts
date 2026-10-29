import { realPrompt, realReply } from './sessionText'
import type { AgentKind } from './types'

export interface SessionDetail {
  firstPrompt?: string
  lastAssistant?: string
  model?: string
  startedAt?: number
  messages: number
}

export interface SessionEvidence {
  branch: string | null
  startedAt?: number
  endedAt?: number
  /** When the session was actually active: activity less than ACTIVE_GAP_MS apart, merged into spans. */
  spans?: [number, number][]
}

/** Activity further apart than this is a break, not work. */
export const ACTIVE_GAP_MS = 5 * 60_000
/** A lone message still counts as a minute of work. */
const MIN_SPAN_MS = 60_000

/** Merges activity times into the spans the session was active in. */
export function activeSpans(times: readonly number[], gap = ACTIVE_GAP_MS): [number, number][] {
  const sorted = [...times].filter(Number.isFinite).sort((a, b) => a - b)
  const spans: [number, number][] = []
  for (const at of sorted) {
    const last = spans.at(-1)
    if (last && at - last[1] <= gap) last[1] = at
    else spans.push([at, at])
  }
  return spans.map(([start, end]) => [start, Math.max(end, start + MIN_SPAN_MS)])
}

/** Metadata from the same bounded sample used by the session index. Gemini stores no git branch. */
export function sessionEvidence(agent: AgentKind, text: string): SessionEvidence {
  const evidence: SessionEvidence = { branch: null }
  let entries = records(text)
  if (agent === 'gemini') {
    try {
      const whole: unknown = JSON.parse(text)
      if (isRecord(whole)) entries = [whole]
    } catch { /* JSONL is handled by records. */ }
  }
  const times: number[] = []
  const takeTime = (value: unknown): void => {
    const at = asTime(value)
    if (at === undefined) return
    times.push(at)
    evidence.startedAt = Math.min(evidence.startedAt ?? at, at)
    evidence.endedAt = Math.max(evidence.endedAt ?? at, at)
  }
  for (const record of entries) {
    takeTime(record.timestamp)
    const payload = isRecord(record.payload) ? record.payload : {}
    if (agent === 'claude' && typeof record.gitBranch === 'string') evidence.branch = record.gitBranch || null
    if (agent === 'codex' && record.type === 'session_meta') {
      takeTime(payload.timestamp)
      const git = isRecord(payload.git) ? payload.git : {}
      if (typeof git.branch === 'string') evidence.branch = git.branch || null
    }
    if (agent === 'gemini') {
      const meta = isRecord(record.$set) ? record.$set : record
      takeTime(meta.startTime)
      takeTime(meta.lastUpdated)
      if (Array.isArray(record.messages)) for (const m of record.messages) if (isRecord(m)) takeTime(m.timestamp)
    }
  }
  if (times.length > 0) evidence.spans = activeSpans(times)
  return evidence
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

function records(text: string): Json[] {
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

const asTime = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function blockText(content: unknown, types: string[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!isRecord(part) || typeof part.text !== 'string') return ''
      return part.type === undefined || types.includes(String(part.type)) ? part.text : ''
    })
    .join('')
}

export function modelLabel(agent: AgentKind, model: string | undefined): string | undefined {
  if (!model) return undefined
  if (agent !== 'claude') return model
  const family = /(opus|sonnet|haiku|fable)/i.exec(model)?.[1]
  return family ? family[0].toUpperCase() + family.slice(1).toLowerCase() : model
}

export function claudeDetail(text: string, scale = 1): SessionDetail {
  let messages = 0
  const detail: SessionDetail = { messages: 0 }
  for (const record of records(text)) {
    const message = isRecord(record.message) ? record.message : {}
    if (detail.startedAt === undefined) detail.startedAt = asTime(record.timestamp)
    if (record.isSidechain === true) continue
    if (record.type === 'user' && record.isMeta !== true) {
      const prompt = realPrompt(blockText(message.content, ['text']))
      if (prompt === null) continue
      messages += 1
      if (detail.firstPrompt === undefined) detail.firstPrompt = prompt
    } else if (record.type === 'assistant') {
      const raw = blockText(message.content, ['text'])
      if (raw.trim() === '') continue
      messages += 1
      if (message.model === '<synthetic>') continue
      const reply = realReply(raw)
      if (reply !== null) detail.lastAssistant = reply
      if (typeof message.model === 'string') detail.model = message.model
    }
  }
  detail.messages = Math.round(messages * scale)
  return detail
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

export function codexDetail(text: string, scale = 1): SessionDetail {
  const events: Turn[] = []
  const items: Turn[] = []
  const detail: SessionDetail = { messages: 0 }
  for (const record of records(text)) {
    const payload = isRecord(record.payload) ? record.payload : {}
    if (record.type === 'session_meta') detail.startedAt = asTime(payload.timestamp) ?? detail.startedAt
    if (record.type === 'turn_context' && typeof payload.model === 'string') detail.model = payload.model
    if (record.type === 'event_msg' && typeof payload.message === 'string') {
      if (payload.type === 'user_message') events.push({ role: 'user', text: payload.message })
      if (payload.type === 'agent_message') events.push({ role: 'assistant', text: payload.message })
    }
    if (record.type === 'response_item' && payload.type === 'message') {
      const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : null
      const body = blockText(payload.content, ['input_text', 'output_text'])
      if (role && body.trim() !== '' && (role === 'assistant' || realPrompt(body) !== null)) items.push({ role, text: body })
    }
  }
  const turns = events.length > 0 ? events : items
  for (const turn of turns) {
    const prompt = turn.role === 'user' ? realPrompt(turn.text) : null
    if (prompt === null) continue
    detail.firstPrompt = prompt
    break
  }
  for (const turn of [...turns].reverse()) {
    const reply = turn.role === 'assistant' ? realReply(turn.text) : null
    if (reply === null) continue
    detail.lastAssistant = reply
    break
  }
  detail.messages = Math.round(turns.length * scale)
  return detail
}

export function geminiDetail(text: string, scale = 1): SessionDetail {
  const detail: SessionDetail = { messages: 0 }
  let messages = 0
  const take = (message: Json): void => {
    const body = blockText(message.content, ['text']).trim()
    if (message.type === 'user' && body && !body.startsWith('/') && !body.startsWith('?')) {
      messages += 1
      if (detail.firstPrompt === undefined) detail.firstPrompt = realPrompt(body) ?? undefined
    } else if (message.type === 'gemini' && body) {
      messages += 1
      const reply = realReply(body)
      if (reply !== null) detail.lastAssistant = reply
      if (typeof message.model === 'string' && message.model) detail.model = message.model
    }
  }
  for (const record of records(text)) {
    if (typeof record.startTime === 'string' && detail.startedAt === undefined) detail.startedAt = asTime(record.startTime)
    if (typeof record.id === 'string' && typeof record.type === 'string') take(record)
    if (Array.isArray(record.messages)) for (const m of record.messages) if (isRecord(m)) take(m)
  }
  detail.messages = Math.round(messages * scale)
  return detail
}

export function contentMatch(agent: AgentKind, text: string, query: string): string | null {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const pieces: string[] = []
  const take = (value: unknown): void => {
    const body = blockText(value, ['text', 'input_text', 'output_text']).replace(/\s+/g, ' ').trim()
    if (body) pieces.push(body)
  }
  for (const record of records(text)) {
    if (agent === 'claude') {
      if (record.type !== 'user' && record.type !== 'assistant') continue
      const message = isRecord(record.message) ? record.message : {}
      take(message.content)
    } else if (agent === 'codex') {
      const payload = isRecord(record.payload) ? record.payload : {}
      if (record.type === 'event_msg' && (payload.type === 'user_message' || payload.type === 'agent_message')) take(payload.message)
      else if (record.type === 'response_item' && payload.type === 'message') take(payload.content)
    } else {
      if (Array.isArray(record.messages)) {
        for (const message of record.messages) {
          if (isRecord(message) && (message.type === 'user' || message.type === 'gemini')) take(message.content)
        }
      } else if (record.type === 'user' || record.type === 'gemini') take(record.content)
    }
  }
  for (const piece of pieces) {
    const lower = piece.toLowerCase()
    if (!words.every((word) => lower.includes(word))) continue
    const at = lower.indexOf(words[0])
    return piece.slice(Math.max(0, at - 70), Math.min(piece.length, at + 180))
  }
  return null
}
