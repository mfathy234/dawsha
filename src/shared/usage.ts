import { AGENTS } from './agents'
import { normalizePath } from './sessionMatch'
import type { AgentLimitEntry } from './agentLimits'
import { limitWindow } from './statusLine'
import type { AgentKind, Project } from './types'

export type UsageRange = 'today' | '7d' | '30d'

export const USAGE_RANGES: { value: UsageRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' }
]

export interface HourUsage {
  tokens: number
  cacheRead: number
}

export interface UsageFile {
  agent: AgentKind
  sessionId: string | null
  cwd: string | null
  hours: Record<string, HourUsage>
}

export interface SessionCost {
  at: number
  usd: number
  cwd: string | null
}

export interface LimitReading {
  at: number
  windows: Record<string, number>
  resets?: Record<string, number>
}

export interface UsageHistory {
  limits: LimitReading[]
  costs: Record<string, SessionCost>
}

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

const asString = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

const pad = (value: number): string => String(value).padStart(2, '0')

export const dayKey = (ms: number): string => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const hourKey = (ms: number): string => `${dayKey(ms)}T${pad(new Date(ms).getHours())}`

function parseTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 100_000_000_000 ? value * 1000 : value
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function addHour(hours: Record<string, HourUsage>, at: number, tokens: number, cacheRead: number): void {
  if (tokens <= 0 && cacheRead <= 0) return
  const key = hourKey(at)
  const current = hours[key] ?? { tokens: 0, cacheRead: 0 }
  hours[key] = { tokens: current.tokens + tokens, cacheRead: current.cacheRead + cacheRead }
}

function parseJson(line: string): Raw | null {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

export interface UsageParser {
  push(line: string): void
  finish(): UsageFile
}

interface ClaudeEntry {
  at: number
  tokens: number
  cacheRead: number
}

export function claudeParser(): UsageParser {
  const entries = new Map<string, ClaudeEntry>()
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
      const tokens = count(usage.input_tokens) + count(usage.output_tokens) + count(usage.cache_creation_input_tokens)
      const cacheRead = count(usage.cache_read_input_tokens)
      const known = entries.get(id)
      entries.set(id, {
        at: known?.at ?? at,
        tokens: Math.max(known?.tokens ?? 0, tokens),
        cacheRead: Math.max(known?.cacheRead ?? 0, cacheRead)
      })
    },
    finish() {
      const hours: Record<string, HourUsage> = {}
      for (const entry of entries.values()) addHour(hours, entry.at, entry.tokens, entry.cacheRead)
      return { agent: 'claude', sessionId, cwd, hours }
    }
  }
}

interface CodexTotals {
  tokens: number
  cacheRead: number
}

function codexTotals(usage: Raw): CodexTotals {
  const input = count(usage.input_tokens)
  const cached = count(usage.cached_input_tokens)
  return { tokens: Math.max(0, input - cached) + count(usage.output_tokens), cacheRead: cached }
}

export function codexParser(): UsageParser {
  const hours: Record<string, HourUsage> = {}
  let cwd: string | null = null
  let sessionId: string | null = null
  let previous: CodexTotals = { tokens: 0, cacheRead: 0 }
  return {
    push(line) {
      if (!line.includes('session_meta') && !line.includes('token_count')) return
      const record = parseJson(line)
      if (!record || !isRecord(record.payload)) return
      if (record.type === 'session_meta') {
        cwd ??= asString(record.payload.cwd)
        sessionId ??= asString(record.payload.id)
        return
      }
      if (record.type !== 'event_msg' || record.payload.type !== 'token_count') return
      const info = record.payload.info
      const total = isRecord(info) && isRecord(info.total_token_usage) ? info.total_token_usage : null
      const at = parseTime(record.timestamp)
      if (!total || at === null) return
      const next = codexTotals(total)
      const reset = next.tokens < previous.tokens || next.cacheRead < previous.cacheRead
      const base = reset ? { tokens: 0, cacheRead: 0 } : previous
      addHour(hours, at, next.tokens - base.tokens, next.cacheRead - base.cacheRead)
      previous = next
    },
    finish() {
      return { agent: 'codex', sessionId, cwd, hours }
    }
  }
}

interface GeminiEntry {
  at: number
  tokens: number
  cacheRead: number
}

export function geminiParser(): UsageParser {
  const entries = new Map<string, GeminiEntry>()
  let sessionId: string | null = null
  let anonymous = 0
  const take = (message: Raw): void => {
    if (message.type !== 'gemini' || !isRecord(message.tokens)) return
    const at = parseTime(message.timestamp)
    if (at === null) return
    const tokens = message.tokens
    const cached = count(tokens.cached)
    const input = Math.max(0, count(tokens.input) - cached)
    const used = input + count(tokens.output) + count(tokens.thoughts) + count(tokens.tool)
    entries.set(asString(message.id) ?? `line-${anonymous++}`, { at, tokens: used, cacheRead: cached })
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
      const hours: Record<string, HourUsage> = {}
      for (const entry of entries.values()) addHour(hours, entry.at, entry.tokens, entry.cacheRead)
      return { agent: 'gemini', sessionId, cwd: null, hours }
    }
  }
}

export function parserFor(agent: AgentKind): UsageParser {
  return agent === 'claude' ? claudeParser() : agent === 'codex' ? codexParser() : geminiParser()
}

export function parseUsageText(agent: AgentKind, text: string): UsageFile {
  const parser = parserFor(agent)
  for (const line of text.split('\n')) parser.push(line)
  return parser.finish()
}

export function projectKeyFor(cwd: string | null, projects: Pick<Project, 'id' | 'folder'>[]): string | null {
  if (!cwd) return null
  const target = normalizePath(cwd)
  let best: { id: string; length: number } | null = null
  for (const project of projects) {
    const folder = normalizePath(project.folder)
    const inside = target === folder || target.startsWith(`${folder}/`)
    if (inside && (!best || folder.length > best.length)) best = { id: project.id, length: folder.length }
  }
  return best?.id ?? null
}

export interface RangeWindow {
  start: number
  end: number
  keys: string[]
  hourly: boolean
}

export function rangeWindow(range: UsageRange, now: number): RangeWindow {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (range === 'today') {
    const keys = Array.from({ length: 24 }, (_, hour) => `${dayKey(today.getTime())}T${pad(hour)}`)
    return { start: today.getTime(), end: now, keys, hourly: true }
  }
  const length = range === '7d' ? 7 : 30
  const keys: string[] = []
  const first = new Date(today)
  first.setDate(first.getDate() - (length - 1))
  for (let index = 0; index < length; index += 1) {
    const day = new Date(first)
    day.setDate(first.getDate() + index)
    keys.push(dayKey(day.getTime()))
  }
  return { start: first.getTime(), end: now, keys, hourly: false }
}

export interface AgentAmount {
  tokens: number
  costUsd: number | null
}

export interface UsageBucket {
  key: string
  perAgent: Record<AgentKind, AgentAmount>
}

export interface ProjectUsage {
  project: string
  projectId: string | null
  sessions: number
  tokens: number
  costUsd: number | null
  topAgent: AgentKind | null
}

export interface AgentUsage {
  agent: AgentKind
  sessions: number
  tokens: number
  cacheRead: number
  costUsd: number | null
}

export interface LimitSeries {
  key: string
  label: string
  points: { at: number; percent: number }[]
}

export interface UsageSource {
  agent: AgentKind
  found: boolean
  files: number
}

export interface UsageReport {
  range: UsageRange
  generatedAt: number
  start: number
  end: number
  hourly: boolean
  buckets: UsageBucket[]
  byProject: ProjectUsage[]
  byAgent: AgentUsage[]
  limits: LimitSeries[]
  hasCost: boolean
  hasTokens: boolean
  sources: UsageSource[]
}

const emptyAmounts = (): Record<AgentKind, AgentAmount> => ({
  claude: { tokens: 0, costUsd: null },
  codex: { tokens: 0, costUsd: null },
  gemini: { tokens: 0, costUsd: null }
})

const OTHER = 'Other'

export interface UsageInput {
  range: UsageRange
  now: number
  files: UsageFile[]
  projects: Pick<Project, 'id' | 'name' | 'folder'>[]
  history: UsageHistory
  sources: UsageSource[]
}

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h limit', seven_day: 'Weekly limit' }
const LIMIT_ORDER = ['five_hour', 'seven_day']

function bucketKeyFor(hourly: boolean, hour: string): string {
  return hourly ? hour : hour.slice(0, 10)
}

function inWindow(window: RangeWindow, at: number): boolean {
  return at >= window.start && at <= window.end
}

function hourStart(hour: string): number {
  const [day, hh] = hour.split('T')
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, Number(hh)).getTime()
}

function addCost(current: number | null, usd: number): number {
  return (current ?? 0) + usd
}

interface ProjectTally {
  sessions: number
  tokens: number
  costUsd: number | null
  perAgent: Record<AgentKind, number>
}

export function buildUsageReport(input: UsageInput): UsageReport {
  const window = rangeWindow(input.range, input.now)
  const buckets = new Map<string, UsageBucket>(window.keys.map((key) => [key, { key, perAgent: emptyAmounts() }]))
  const agents = new Map<AgentKind, AgentUsage>(
    AGENTS.map((agent) => [agent, { agent, sessions: 0, tokens: 0, cacheRead: 0, costUsd: null }])
  )
  const projects = new Map<string, ProjectTally>()
  const names = new Map(input.projects.map((project) => [project.id, project.name]))
  const tally = (projectId: string | null): ProjectTally => {
    const key = projectId ?? OTHER
    const existing = projects.get(key)
    if (existing) return existing
    const created: ProjectTally = { sessions: 0, tokens: 0, costUsd: null, perAgent: { claude: 0, codex: 0, gemini: 0 } }
    projects.set(key, created)
    return created
  }
  let hasTokens = false
  for (const file of input.files) {
    const projectId = projectKeyFor(file.cwd, input.projects)
    let used = 0
    for (const [hour, usage] of Object.entries(file.hours)) {
      if (!inWindow(window, hourStart(hour))) continue
      const bucket = buckets.get(bucketKeyFor(window.hourly, hour))
      if (!bucket) continue
      bucket.perAgent[file.agent].tokens += usage.tokens
      const agent = agents.get(file.agent)
      if (agent) {
        agent.tokens += usage.tokens
        agent.cacheRead += usage.cacheRead
      }
      const project = tally(projectId)
      project.tokens += usage.tokens
      project.perAgent[file.agent] += usage.tokens
      used += usage.tokens + usage.cacheRead
    }
    if (used > 0) {
      hasTokens = true
      const agent = agents.get(file.agent)
      if (agent) agent.sessions += 1
      tally(projectId).sessions += 1
    }
  }
  let hasCost = false
  for (const cost of Object.values(input.history.costs)) {
    if (!inWindow(window, cost.at)) continue
    const bucket = buckets.get(window.hourly ? hourKey(cost.at) : dayKey(cost.at))
    if (!bucket) continue
    hasCost = true
    bucket.perAgent.claude.costUsd = addCost(bucket.perAgent.claude.costUsd, cost.usd)
    const agent = agents.get('claude')
    if (agent) agent.costUsd = addCost(agent.costUsd, cost.usd)
    const project = tally(projectKeyFor(cost.cwd, input.projects))
    project.costUsd = addCost(project.costUsd, cost.usd)
  }
  const byProject = [...projects.entries()]
    .map(([key, value]): ProjectUsage => {
      const top = AGENTS.reduce<AgentKind | null>(
        (best, agent) => (value.perAgent[agent] > 0 && (best === null || value.perAgent[agent] > value.perAgent[best]) ? agent : best),
        null
      )
      return {
        project: key === OTHER ? OTHER : (names.get(key) ?? OTHER),
        projectId: key === OTHER ? null : key,
        sessions: value.sessions,
        tokens: value.tokens,
        costUsd: value.costUsd,
        topAgent: top
      }
    })
    .sort((a, b) => b.tokens - a.tokens || a.project.localeCompare(b.project))
  return {
    range: input.range,
    generatedAt: input.now,
    start: window.start,
    end: window.end,
    hourly: window.hourly,
    buckets: window.keys.map((key) => buckets.get(key) as UsageBucket),
    byProject,
    byAgent: AGENTS.map((agent) => agents.get(agent) as AgentUsage),
    limits: limitSeries(input.history.limits, window),
    hasCost,
    hasTokens,
    sources: input.sources
  }
}

function limitSeries(readings: LimitReading[], window: RangeWindow): LimitSeries[] {
  const series = new Map<string, LimitSeries>()
  for (const reading of [...readings].sort((a, b) => a.at - b.at)) {
    if (!inWindow(window, reading.at)) continue
    for (const [key, percent] of Object.entries(reading.windows)) {
      if (!LIMIT_LABELS[key]) continue
      const entry = series.get(key) ?? { key, label: LIMIT_LABELS[key], points: [] }
      entry.points.push({ at: reading.at, percent })
      series.set(key, entry)
    }
  }
  return LIMIT_ORDER.flatMap((key) => (series.has(key) ? [series.get(key) as LimitSeries] : []))
}

export function formatTokens(value: number): string {
  if (value < 1000) return String(Math.round(value))
  if (value < 999_500) return value < 10_000 ? `${(value / 1000).toFixed(1)}K` : `${Math.round(value / 1000)}K`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)}M`
}

export const formatUsd = (value: number): string => `$${value.toFixed(2)}`

export const MAX_LIMIT_READINGS = 3000
export const MAX_COST_ENTRIES = 600
export const LIMIT_REREAD_MS = 15 * 60_000

export function emptyHistory(): UsageHistory {
  return { limits: [], costs: {} }
}

export function sanitizeHistory(value: unknown): UsageHistory {
  if (!isRecord(value)) return emptyHistory()
  const limits: LimitReading[] = []
  for (const item of Array.isArray(value.limits) ? value.limits : []) {
    if (!isRecord(item) || typeof item.at !== 'number' || !isRecord(item.w)) continue
    const windows: Record<string, number> = {}
    for (const [key, percent] of Object.entries(item.w)) {
      if (typeof percent === 'number' && Number.isFinite(percent)) windows[key] = Math.min(100, Math.max(0, percent))
    }
    const resets: Record<string, number> = {}
    if (isRecord(item.r)) {
      for (const [key, at] of Object.entries(item.r)) if (typeof at === 'number' && Number.isFinite(at) && key in windows) resets[key] = at
    }
    if (Object.keys(windows).length > 0) limits.push(Object.keys(resets).length > 0 ? { at: item.at, windows, resets } : { at: item.at, windows })
  }
  const costs: Record<string, SessionCost> = {}
  if (isRecord(value.costs)) {
    for (const [id, item] of Object.entries(value.costs)) {
      if (!isRecord(item) || typeof item.at !== 'number' || typeof item.usd !== 'number' || item.usd < 0) continue
      costs[id] = { at: item.at, usd: item.usd, cwd: asString(item.cwd) }
    }
  }
  return { limits: limits.slice(-MAX_LIMIT_READINGS), costs }
}

export function serializeHistory(history: UsageHistory): unknown {
  return {
    v: 1,
    limits: history.limits.map((reading) => (reading.resets ? { at: reading.at, w: reading.windows, r: reading.resets } : { at: reading.at, w: reading.windows })),
    costs: history.costs
  }
}

export interface StatusReading {
  sessionId: string
  cwd: string | null
  costUsd: number | null
  receivedAt: number
  windows: { key: string; percent: number; resetsAt?: number | null }[]
}

function windowsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Math.round(a[key]) === Math.round(b[key] ?? -1))
}

export function recordReadings(history: UsageHistory, readings: StatusReading[]): UsageHistory {
  let limits = history.limits
  const costs = { ...history.costs }
  let changed = false
  for (const reading of [...readings].sort((a, b) => a.receivedAt - b.receivedAt)) {
    if (reading.costUsd !== null && reading.costUsd >= 0) {
      const known = costs[reading.sessionId]
      if (!known || (reading.costUsd !== known.usd && reading.receivedAt >= known.at)) {
        costs[reading.sessionId] = { at: reading.receivedAt, usd: reading.costUsd, cwd: reading.cwd }
        changed = true
      }
    }
    if (reading.windows.length > 0) {
      const windows = Object.fromEntries(reading.windows.map((window) => [window.key, window.percent]))
      const resetPairs = reading.windows.flatMap((window) => (typeof window.resetsAt === 'number' ? [[window.key, window.resetsAt] as const] : []))
      const resets = resetPairs.length > 0 ? Object.fromEntries(resetPairs) : undefined
      const last = limits[limits.length - 1]
      const fresh = !last || reading.receivedAt > last.at
      const different = !last || !windowsEqual(last.windows, windows) || reading.receivedAt - last.at >= LIMIT_REREAD_MS
      if (fresh && different) {
        limits = [...limits, resets ? { at: reading.receivedAt, windows, resets } : { at: reading.receivedAt, windows }].slice(-MAX_LIMIT_READINGS)
        changed = true
      }
    }
  }
  if (!changed) return history
  const ids = Object.keys(costs)
  if (ids.length > MAX_COST_ENTRIES) {
    const oldest = ids.sort((a, b) => costs[a].at - costs[b].at).slice(0, ids.length - MAX_COST_ENTRIES)
    for (const id of oldest) delete costs[id]
  }
  return { limits, costs }
}

/** The last limit windows a Claude session reported, with their reset times when they were saved; null when none was ever recorded. */
export function lastClaudeLimits(history: UsageHistory): AgentLimitEntry | null {
  const reading = history.limits[history.limits.length - 1]
  if (!reading) return null
  const rank = (key: string): number => (key === 'five_hour' ? 0 : key === 'seven_day' ? 1 : 2)
  const windows = Object.entries(reading.windows)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, percent]) => limitWindow(key, percent, reading.resets?.[key] ?? null))
  return { windows, at: reading.at }
}
