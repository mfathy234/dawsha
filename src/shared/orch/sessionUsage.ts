import type { AgentUsage } from './types'

export type UsageRunner = 'claude' | 'codex' | 'gemini'

type Raw = Record<string, unknown>

interface Split {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

const idOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function records(text: string): Raw[] {
  const out: Raw[] = []
  for (const line of text.split('\n')) {
    const value = parseJson(line.trim())
    if (isRecord(value)) out.push(value)
  }
  return out
}

const emptySplit = (): Split => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

function toUsage(split: Split): AgentUsage {
  return {
    inputTokens: split.input,
    outputTokens: split.output,
    cacheReadTokens: split.cacheRead,
    cacheWriteTokens: split.cacheWrite,
    reportedCostUsd: null
  }
}

function sum(items: Iterable<Split>): Split {
  const total = emptySplit()
  for (const item of items) {
    total.input += item.input
    total.output += item.output
    total.cacheRead += item.cacheRead
    total.cacheWrite += item.cacheWrite
  }
  return total
}

function claudeUsage(text: string): Split {
  const entries = new Map<string, Split>()
  let anonymous = 0
  for (const record of records(text)) {
    if (record.type !== 'assistant' || !isRecord(record.message) || !isRecord(record.message.usage)) continue
    const usage = record.message.usage
    const id = idOf(record.message.id) ?? idOf(record.requestId) ?? `line-${anonymous++}`
    const next: Split = {
      input: count(usage.input_tokens),
      output: count(usage.output_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      cacheWrite: count(usage.cache_creation_input_tokens)
    }
    const known = entries.get(id)
    entries.set(id, known ? {
      input: Math.max(known.input, next.input),
      output: Math.max(known.output, next.output),
      cacheRead: Math.max(known.cacheRead, next.cacheRead),
      cacheWrite: Math.max(known.cacheWrite, next.cacheWrite)
    } : next)
  }
  return sum(entries.values())
}

/** Codex input_tokens includes cached ones and output_tokens already includes reasoning, so neither is re-added. */
function codexUsage(text: string): Split {
  let last: Raw | null = null
  for (const record of records(text)) {
    if (record.type !== 'event_msg' || !isRecord(record.payload) || record.payload.type !== 'token_count') continue
    const info = record.payload.info
    if (isRecord(info) && isRecord(info.total_token_usage)) last = info.total_token_usage
  }
  if (!last) return emptySplit()
  const cached = count(last.cached_input_tokens)
  return { input: Math.max(0, count(last.input_tokens) - cached), output: count(last.output_tokens), cacheRead: cached, cacheWrite: 0 }
}

/** Gemini input includes cached; output covers candidates + thoughts + tool tokens. */
function geminiUsage(text: string): Split {
  const entries = new Map<string, Split>()
  let anonymous = 0
  const take = (message: Raw): void => {
    if (message.type !== 'gemini' || !isRecord(message.tokens)) return
    const tokens = message.tokens
    const cached = count(tokens.cached)
    entries.set(idOf(message.id) ?? `line-${anonymous++}`, {
      input: Math.max(0, count(tokens.input) - cached),
      output: count(tokens.output) + count(tokens.thoughts) + count(tokens.tool),
      cacheRead: cached,
      cacheWrite: 0
    })
  }
  const takeRecord = (record: Raw): void => {
    if (Array.isArray(record.messages)) for (const message of record.messages) if (isRecord(message)) take(message)
    take(record)
  }
  const whole = parseJson(text.trim())
  if (isRecord(whole)) takeRecord(whole)
  else for (const record of records(text)) takeRecord(record)
  return sum(entries.values())
}

export function sessionUsage(runner: UsageRunner, fileText: string): AgentUsage {
  const split = runner === 'claude' ? claudeUsage(fileText) : runner === 'codex' ? codexUsage(fileText) : geminiUsage(fileText)
  return toUsage(split)
}
