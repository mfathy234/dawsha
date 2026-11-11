import type { AgentKind } from './types'
import { dayKey } from './usage'

/** What one agent session used on one day with one model. Read only for the CSV export. */
export interface UsageDetail {
  day: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface SessionDetail {
  agent: AgentKind
  sessionId: string | null
  cwd: string | null
  rows: UsageDetail[]
}

export interface DetailParser {
  push(line: string): void
  finish(): SessionDetail
}

type Raw = Record<string, unknown>
type Amounts = Pick<UsageDetail, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
const asString = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const ZERO: Amounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const isEmpty = (amounts: Amounts): boolean => amounts.input + amounts.output + amounts.cacheRead + amounts.cacheWrite <= 0

function parseTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 100_000_000_000 ? value * 1000 : value
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function parseJson(line: string): Raw | null {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/** Adds each amount into the row of its day and model; the inputs stay as they were. */
export function foldDetail(entries: readonly { at: number; model: string; amounts: Amounts }[]): UsageDetail[] {
  const rows = new Map<string, UsageDetail>()
  for (const entry of entries) {
    if (isEmpty(entry.amounts)) continue
    const day = dayKey(entry.at)
    const key = `${day}\0${entry.model}`
    const known = rows.get(key) ?? { day, model: entry.model, ...ZERO }
    rows.set(key, {
      ...known,
      input: known.input + entry.amounts.input,
      output: known.output + entry.amounts.output,
      cacheRead: known.cacheRead + entry.amounts.cacheRead,
      cacheWrite: known.cacheWrite + entry.amounts.cacheWrite
    })
  }
  return [...rows.values()]
}

interface Entry {
  at: number
  model: string
  amounts: Amounts
}

const maxAmounts = (a: Amounts, b: Amounts): Amounts => ({
  input: Math.max(a.input, b.input),
  output: Math.max(a.output, b.output),
  cacheRead: Math.max(a.cacheRead, b.cacheRead),
  cacheWrite: Math.max(a.cacheWrite, b.cacheWrite)
})

function claudeDetailParser(): DetailParser {
  const entries = new Map<string, Entry>()
  let cwd: string | null = null
  let sessionId: string | null = null
  let anonymous = 0
  return {
    push(line) {
      if (!line.includes('"usage"')) return
      const record = parseJson(line)
      if (!record || record.type !== 'assistant' || !isRecord(record.message) || !isRecord(record.message.usage)) return
      cwd ??= asString(record.cwd)
      sessionId ??= asString(record.sessionId)
      const at = parseTime(record.timestamp)
      if (at === null) return
      const usage = record.message.usage
      const id = asString(record.message.id) ?? asString(record.requestId) ?? `line-${anonymous++}`
      const amounts: Amounts = {
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
        cacheRead: count(usage.cache_read_input_tokens),
        cacheWrite: count(usage.cache_creation_input_tokens)
      }
      const known = entries.get(id)
      entries.set(id, { at: known?.at ?? at, model: known?.model || (asString(record.message.model) ?? ''), amounts: known ? maxAmounts(known.amounts, amounts) : amounts })
    },
    finish() {
      return { agent: 'claude', sessionId, cwd, rows: foldDetail([...entries.values()]) }
    }
  }
}

function codexAmounts(usage: Raw): Amounts {
  const cached = count(usage.cached_input_tokens)
  return { input: Math.max(0, count(usage.input_tokens) - cached), output: count(usage.output_tokens), cacheRead: cached, cacheWrite: 0 }
}

const total = (a: Amounts): number => a.input + a.output + a.cacheRead

function codexDetailParser(): DetailParser {
  const entries: Entry[] = []
  let cwd: string | null = null
  let sessionId: string | null = null
  let model = ''
  let previous: Amounts = ZERO
  return {
    push(line) {
      if (!line.includes('session_meta') && !line.includes('token_count') && !line.includes('turn_context')) return
      const record = parseJson(line)
      if (!record || !isRecord(record.payload)) return
      if (record.type === 'session_meta') {
        cwd ??= asString(record.payload.cwd)
        sessionId ??= asString(record.payload.id)
        return
      }
      if (record.type === 'turn_context') {
        model = asString(record.payload.model) ?? model
        return
      }
      if (record.type !== 'event_msg' || record.payload.type !== 'token_count') return
      const info = record.payload.info
      const totals = isRecord(info) && isRecord(info.total_token_usage) ? info.total_token_usage : null
      const at = parseTime(record.timestamp)
      if (!totals || at === null) return
      const next = codexAmounts(totals)
      const reset = next.input < previous.input || next.output < previous.output || next.cacheRead < previous.cacheRead
      const base = reset ? ZERO : previous
      const delta: Amounts = { input: next.input - base.input, output: next.output - base.output, cacheRead: next.cacheRead - base.cacheRead, cacheWrite: 0 }
      if (total(delta) > 0) entries.push({ at, model, amounts: delta })
      previous = next
    },
    finish() {
      return { agent: 'codex', sessionId, cwd, rows: foldDetail(entries) }
    }
  }
}

function geminiDetailParser(): DetailParser {
  const entries = new Map<string, Entry>()
  let sessionId: string | null = null
  let anonymous = 0
  const take = (message: Raw): void => {
    if (message.type !== 'gemini' || !isRecord(message.tokens)) return
    const at = parseTime(message.timestamp)
    if (at === null) return
    const tokens = message.tokens
    const cached = count(tokens.cached)
    const amounts: Amounts = {
      input: Math.max(0, count(tokens.input) - cached),
      output: count(tokens.output) + count(tokens.thoughts) + count(tokens.tool),
      cacheRead: cached,
      cacheWrite: 0
    }
    entries.set(asString(message.id) ?? `line-${anonymous++}`, { at, model: asString(message.model) ?? '', amounts })
  }
  const takeRecord = (record: Raw): void => {
    if (typeof record.sessionId === 'string') sessionId ??= record.sessionId
    if (Array.isArray(record.messages)) for (const message of record.messages) if (isRecord(message)) take(message)
    take(record)
  }
  return {
    push(line) {
      if (!line.includes('"tokens"') && !line.includes('"sessionId"')) return
      const record = parseJson(line)
      if (record) takeRecord(record)
    },
    finish() {
      return { agent: 'gemini', sessionId, cwd: null, rows: foldDetail([...entries.values()]) }
    }
  }
}

export function detailParserFor(agent: AgentKind): DetailParser {
  return agent === 'claude' ? claudeDetailParser() : agent === 'codex' ? codexDetailParser() : geminiDetailParser()
}
