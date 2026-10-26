import { RUNNING_WINDOW_MS, type BgKind, type BgStatus } from './backgroundAgents'
import { clipWords, flattenText, realPrompt } from './sessionText'

type Rec = Record<string, unknown>

export interface AgentUsage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/** What a transcript says about one agent, before the project, parent title and cost are known. */
export interface ParsedAgent {
  id: string
  kind: BgKind
  parentId: string
  description: string
  type: string
  automatic: boolean
  model: string | null
  depth: number
  parentAgentId: string | null
  startedAt: number
  endedAt: number | null
  lastActivityAt: number
  status: BgStatus
  statusNote: string | null
  cwd: string | null
  usage: AgentUsage
  usageApprox: boolean
  lastStep: string
  result: string
}

export interface Sampled {
  head: string
  tail: string
  /** True when head is the whole file. */
  whole: boolean
  /** Bytes read (head plus tail) and the file size, to scale partial token sums. */
  read: number
  size: number
}

const DESCRIPTION_MAX = 140
const STEP_MAX = 110
const RESULT_MAX = 1200

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
const time = (value: unknown): number | null => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(ms) ? null : ms
}

function records(text: string): Rec[] {
  const out: Rec[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const value: unknown = JSON.parse(line)
      if (isRec(value)) out.push(value)
    } catch {
      continue
    }
  }
  return out
}

const emptyUsage = (): AgentUsage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })

/** One tool call as a short line: its name and the most telling argument. */
export function briefInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (!isRec(input)) return ''
  for (const key of ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt', 'message']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return value.join(' ')
  }
  return Object.values(input).find((value): value is string => typeof value === 'string') ?? ''
}

function stepLine(name: string, input: unknown): string {
  const brief = flattenText(briefInput(input))
  return clipWords(brief ? `${name} ${brief}` : name, STEP_MAX)
}

const shortText = (raw: string, limit: number): string => clipWords(flattenText(raw), limit)

// ---- Claude Code ----

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => (isRec(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : '')).filter(Boolean).join('\n')
}

function claudeUsage(parts: readonly Rec[], sampled: Sampled): { usage: AgentUsage; approx: boolean } {
  const byMessage = new Map<string, AgentUsage>()
  let anonymous = 0
  for (const record of parts) {
    if (record.type !== 'assistant' || !isRec(record.message) || !isRec(record.message.usage)) continue
    const usage = record.message.usage
    const id = str(record.message.id) ?? str(record.requestId) ?? `line-${anonymous++}`
    const known = byMessage.get(id) ?? emptyUsage()
    byMessage.set(id, {
      input: Math.max(known.input, num(usage.input_tokens)),
      output: Math.max(known.output, num(usage.output_tokens)),
      cacheWrite: Math.max(known.cacheWrite, num(usage.cache_creation_input_tokens)),
      cacheRead: Math.max(known.cacheRead, num(usage.cache_read_input_tokens))
    })
  }
  const sum = [...byMessage.values()].reduce((all, next) => ({ input: all.input + next.input, output: all.output + next.output, cacheWrite: all.cacheWrite + next.cacheWrite, cacheRead: all.cacheRead + next.cacheRead }), emptyUsage())
  if (sampled.whole || sampled.read <= 0) return { usage: sum, approx: false }
  const scale = sampled.size / sampled.read
  return { usage: { input: Math.round(sum.input * scale), output: Math.round(sum.output * scale), cacheWrite: Math.round(sum.cacheWrite * scale), cacheRead: Math.round(sum.cacheRead * scale) }, approx: true }
}

function headField(head: string, key: string): string | null {
  const match = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(head)
  if (!match) return null
  try {
    return str(JSON.parse(`"${match[1]}"`))
  } catch {
    return null
  }
}

function lastStepOf(assistants: readonly Rec[]): string {
  for (let index = assistants.length - 1; index >= 0; index -= 1) {
    const message = assistants[index].message
    const content = isRec(message) ? message.content : null
    if (!Array.isArray(content)) continue
    for (let at = content.length - 1; at >= 0; at -= 1) {
      const block = content[at]
      if (!isRec(block)) continue
      if (block.type === 'tool_use' && typeof block.name === 'string') return stepLine(block.name, block.input)
      if (block.type === 'text' && typeof block.text === 'string' && flattenText(block.text)) return shortText(block.text, STEP_MAX)
    }
  }
  return ''
}

/** The final answer: every text block of the last assistant message. */
function claudeResult(assistants: readonly Rec[]): string {
  const last = assistants[assistants.length - 1]
  if (!last || !isRec(last.message)) return ''
  const id = str(last.message.id)
  const group = id ? assistants.filter((record) => isRec(record.message) && record.message.id === id) : [last]
  return shortText(group.map((record) => textOf(isRec(record.message) ? record.message.content : '')).join('\n'), RESULT_MAX)
}

export interface ClaudeAgentInput extends Sampled {
  id: string
  parentId: string
  meta: unknown
  mtime: number
  /** When the transcript's first line is cut or has no time, e.g. the meta file's creation time. */
  fallbackStart: number
  now: number
}

/** `<session>/subagents/agent-<id>.jsonl` plus its meta file. */
export function parseClaudeAgent(input: ClaudeAgentInput): ParsedAgent {
  const meta = isRec(input.meta) ? input.meta : {}
  const headRecords = records(input.head)
  const tailRecords = input.whole ? headRecords : records(input.tail)
  const all = input.whole ? headRecords : [...headRecords, ...tailRecords]
  const turns = tailRecords.filter((record) => record.type === 'assistant' || record.type === 'user')
  const assistants = tailRecords.filter((record) => record.type === 'assistant' && isRec(record.message))
  const lastTurn = turns[turns.length - 1]
  const lastAssistant = assistants[assistants.length - 1]
  const lastTime = tailRecords.reduce((best, record) => Math.max(best, time(record.timestamp) ?? 0), 0)
  const lastActivityAt = lastTime || input.mtime
  const startedAt = headRecords.length > 0 ? time(headRecords[0].timestamp) : null
  const startField = startedAt ?? time(headField(input.head, 'timestamp')) ?? input.fallbackStart
  const stopReason = lastAssistant && isRec(lastAssistant.message) ? lastAssistant.message.stop_reason : null
  const apiError = lastAssistant?.isApiErrorMessage === true
  const finishedTurn = lastTurn === lastAssistant && stopReason === 'end_turn'
  let status: BgStatus
  let statusNote: string | null = null
  if (meta.stoppedByUser === true) {
    status = 'failed'
    statusNote = 'Stopped by you'
  } else if (apiError) {
    status = 'failed'
    statusNote = 'Ended with an API error'
  } else if (meta.finished === true || finishedTurn) {
    status = 'done'
  } else if (input.now - lastActivityAt < RUNNING_WINDOW_MS) {
    status = 'running'
  } else {
    status = 'failed'
    statusNote = 'Interrupted: no final answer and no recent activity'
  }
  const { usage, approx } = claudeUsage(all, input)
  const model = str(meta.model) ?? (lastAssistant && isRec(lastAssistant.message) ? str(lastAssistant.message.model) : null)
  const type = meta.isFork === true ? 'fork' : str(meta.agentType) ?? 'agent'
  return {
    id: input.id,
    kind: 'claude',
    parentId: input.parentId,
    description: clipWords(flattenText(str(meta.description) ?? ''), DESCRIPTION_MAX) || 'Background agent',
    type,
    automatic: false,
    model,
    depth: num(meta.spawnDepth) || 1,
    parentAgentId: str(meta.parentAgentId),
    startedAt: startField,
    endedAt: status === 'running' ? null : lastActivityAt,
    lastActivityAt,
    status,
    statusNote,
    cwd: headField(input.head, 'cwd'),
    usage,
    usageApprox: approx,
    lastStep: status === 'running' || status === 'failed' ? lastStepOf(assistants) : '',
    result: status === 'running' ? '' : claudeResult(assistants)
  }
}

// ---- Codex ----

const GUARDIAN_OUTCOME = /"outcome"\s*:\s*"([^"]+)"/

function guardianSummary(message: string): { outcome: string | null; text: string } {
  try {
    const value: unknown = JSON.parse(message)
    if (isRec(value)) {
      const outcome = str(value.outcome)
      const risk = str(value.risk_level)
      const why = str(value.rationale)
      const head = [outcome, risk ? `risk ${risk}` : null].filter(Boolean).join(', ')
      return { outcome, text: shortText([head, why].filter(Boolean).join(': '), RESULT_MAX) }
    }
  } catch {
    // Not JSON: fall through to the plain text.
  }
  return { outcome: GUARDIAN_OUTCOME.exec(message)?.[1] ?? null, text: shortText(message, RESULT_MAX) }
}

interface CodexSource {
  guardian: boolean
  type: string
  automatic: boolean
  depth: number
  name: string | null
  parentId: string | null
}

function codexSource(payload: Rec): CodexSource | null {
  const source = payload.source
  if (!isRec(source) && typeof source !== 'string') return null
  const sub = isRec(source) ? source.subagent : null
  if (sub === undefined || sub === null) return null
  const spawn = isRec(sub) && isRec(sub.thread_spawn) ? sub.thread_spawn : null
  const other = isRec(sub) ? str(sub.other) : typeof sub === 'string' ? sub : null
  const guardian = other === 'guardian' || payload.thread_source === 'guardian_review'
  const path = spawn ? str(spawn.agent_path) ?? str(spawn.task_name) : null
  const name = (path ? path.split('/').filter(Boolean).pop() ?? null : null) ?? (spawn ? str(spawn.agent_nickname) ?? str(spawn.agent_role) : null)
  const automatic = guardian || other === 'compact' || other === 'memory_consolidation'
  return {
    guardian,
    type: guardian ? 'guardian review' : spawn || !other ? 'spawn_agent' : other,
    automatic,
    depth: spawn ? num(spawn.depth) || 1 : 1,
    name,
    parentId: str(payload.parent_thread_id) ?? (spawn ? str(spawn.parent_thread_id) : null)
  }
}

function codexUsage(parts: readonly Rec[]): AgentUsage {
  let total: Rec | null = null
  for (const record of parts) {
    const payload = isRec(record.payload) ? record.payload : null
    if (record.type !== 'event_msg' || payload?.type !== 'token_count' || !isRec(payload.info) || !isRec(payload.info.total_token_usage)) continue
    total = payload.info.total_token_usage
  }
  if (!total) return emptyUsage()
  const cached = num(total.cached_input_tokens)
  return { input: Math.max(0, num(total.input_tokens) - cached), output: num(total.output_tokens), cacheWrite: num(total.cache_write_input_tokens), cacheRead: cached }
}

function codexStep(parts: readonly Rec[]): string {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const body = parts[index].payload
    const payload = isRec(body) ? body : null
    if (parts[index].type !== 'response_item' || !payload || (payload.type !== 'function_call' && payload.type !== 'custom_tool_call') || typeof payload.name !== 'string') continue
    let args: unknown = payload.arguments ?? payload.input
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        // Plain text arguments stay as they are.
      }
    }
    return stepLine(payload.name, args)
  }
  return ''
}

function firstUserPrompt(parts: readonly Rec[]): string | null {
  for (const record of parts) {
    const payload = isRec(record.payload) ? record.payload : null
    if (record.type !== 'response_item' || payload?.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) continue
    for (const block of payload.content) {
      if (!isRec(block) || typeof block.text !== 'string') continue
      const prompt = realPrompt(block.text, DESCRIPTION_MAX)
      if (prompt) return prompt
    }
  }
  return null
}

const lastModel = (tail: string): string | null => {
  let model: string | null = null
  for (const line of tail.split('\n')) {
    if (!line.includes('"turn_context"')) continue
    const found = /"model":"([^"]+)"/.exec(line)?.[1]
    if (found) model = found
  }
  return model
}

export function codexParentId(firstLine: string): string | null {
  try {
    const raw: unknown = JSON.parse(firstLine)
    if (!isRec(raw) || raw.type !== 'session_meta' || !isRec(raw.payload)) return null
    return codexSource(raw.payload) ? codexSource(raw.payload)?.parentId ?? null : null
  } catch {
    return null
  }
}

export interface CodexAgentInput extends Sampled {
  mtime: number
  now: number
}

/** A rollout file; null unless its first record says it is a sub-agent with a parent thread. */
export function parseCodexAgent(input: CodexAgentInput): ParsedAgent | null {
  const headRecords = records(input.head)
  const first = headRecords[0]
  const payload = first && first.type === 'session_meta' && isRec(first.payload) ? first.payload : null
  const id = payload ? str(payload.id) : null
  const source = payload ? codexSource(payload) : null
  if (!payload || !id || !source?.parentId) return null
  const tailRecords = input.whole ? headRecords : records(input.tail)
  const events = tailRecords.flatMap((record) => {
    const body = isRec(record.payload) ? record.payload : null
    if (record.type !== 'event_msg' || !body || typeof body.type !== 'string') return []
    return ['task_started', 'task_complete', 'turn_aborted', 'error'].includes(body.type) ? [{ type: body.type, at: time(record.timestamp), body }] : []
  })
  const last = events[events.length - 1]
  const completes = events.filter((event) => event.type === 'task_complete')
  const lastComplete = completes[completes.length - 1]
  const lastTime = tailRecords.reduce((best, record) => Math.max(best, time(record.timestamp) ?? 0), 0)
  const lastActivityAt = lastTime || input.mtime
  let status: BgStatus
  let statusNote: string | null = null
  if (last?.type === 'turn_aborted') {
    status = 'failed'
    statusNote = 'Interrupted'
  } else if (last?.type === 'error') {
    status = 'failed'
    statusNote = shortText(str(last.body.message) ?? 'Ended with an error', 160)
  } else if (last?.type === 'task_complete') {
    status = 'done'
  } else if (input.now - lastActivityAt < RUNNING_WINDOW_MS) {
    status = 'running'
  } else {
    status = last ? 'failed' : 'done'
    statusNote = last ? 'Interrupted: the turn never completed' : null
  }
  const message = lastComplete ? str(lastComplete.body.last_agent_message) : null
  const guardian = source.guardian && message ? guardianSummary(message) : null
  const checks = completes.length
  const description = source.guardian
    ? `Safety review${guardian?.outcome ? ` · ${guardian.outcome}` : ''}${checks > 1 ? ` · ${checks}${input.whole ? '' : '+'} checks` : ''}`
    : firstUserPrompt(headRecords) ?? source.name ?? 'Codex agent'
  const started = time(payload.timestamp) ?? input.mtime
  return {
    id,
    kind: 'codex',
    parentId: source.parentId,
    description: clipWords(description, DESCRIPTION_MAX),
    type: source.type,
    automatic: source.automatic,
    model: lastModel(input.whole ? input.head : input.tail) ?? lastModel(input.head),
    depth: source.depth,
    parentAgentId: null,
    startedAt: started,
    endedAt: status === 'running' ? null : lastComplete?.at ?? lastActivityAt,
    lastActivityAt,
    status,
    statusNote,
    cwd: str(payload.cwd),
    usage: codexUsage(tailRecords),
    usageApprox: false,
    lastStep: source.guardian ? '' : status === 'done' ? '' : codexStep(tailRecords),
    result: status === 'running' ? '' : guardian ? guardian.text : message ? shortText(message, RESULT_MAX) : ''
  }
}
