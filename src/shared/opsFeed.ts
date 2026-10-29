import { modelFamily, rateLimitLabel, toMillis } from './statusLine'
import type { ModelFamily, RateLimitWindow, StatusInfo } from './types'

type Raw = Record<string, unknown>

export type AgentStatus = 'waiting' | 'running' | 'done' | 'failed'
export type CachePhase = 'none' | 'warm' | 'lapsing' | 'cold'

export interface OpsAgent {
  id: string
  description: string
  type: string | null
  model: string | null
  family: ModelFamily | null
  status: AgentStatus
  startedAt: number | null
  finishedAt: number | null
  tokens: number | null
  tools: number | null
  lastStep: string | null
}

export interface OpsAdvisor {
  status: 'running' | 'done'
  verdict: string | null
  note: string | null
  description: string | null
}

export interface OpsFile {
  path: string
  kind: 'A' | 'M'
  by: string | null
  family: ModelFamily | null
  at: number | null
}

export interface OpsCheck {
  kind: 'build' | 'test'
  target: string | null
  ok: boolean
  summary: string | null
  at: number | null
}

export interface OpsSnapshot {
  sessionId: string
  cwd: string | null
  updatedAt: number
  ended: boolean
  model: string | null
  family: ModelFamily
  plan: { title: string | null; done: number; total: number } | null
  agents: OpsAgent[]
  advisor: OpsAdvisor | null
  context: { percent: number | null; tokens: number | null; window: number | null; stage: string | null } | null
  compactions: number | null
  cache: { phase: CachePhase; leftMs: number | null; hitPercent: number | null } | null
  limits: RateLimitWindow[]
  files: OpsFile[]
  checks: OpsCheck[]
}

const AGENT_STATUSES: AgentStatus[] = ['waiting', 'running', 'done', 'failed']
const CACHE_PHASES: CachePhase[] = ['none', 'warm', 'lapsing', 'cold']
const MAX_FILES = 40
const FAMILIES: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'fable']

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value))

export function perModelFamily(key: string): ModelFamily | null {
  const family = modelFamily(key)
  return FAMILIES.includes(family) ? family : null
}

function parseAgent(value: unknown): OpsAgent | null {
  if (!isRecord(value)) return null
  const id = str(value.id)
  if (!id) return null
  const status = AGENT_STATUSES.find((s) => s === value.status) ?? 'waiting'
  const model = str(value.model)
  return {
    id,
    description: str(value.description) ?? id,
    type: str(value.type),
    model,
    family: model ? modelFamily(model) : null,
    status,
    startedAt: num(value.startedAt),
    finishedAt: num(value.finishedAt),
    tokens: num(value.tokens),
    tools: num(value.tools),
    lastStep: str(value.lastStep)
  }
}

function parseAdvisor(value: unknown): OpsAdvisor | null {
  if (!isRecord(value)) return null
  return {
    status: value.status === 'running' ? 'running' : 'done',
    verdict: str(value.verdict),
    note: str(value.note),
    description: str(value.description)
  }
}

function parseFile(value: unknown): OpsFile | null {
  if (!isRecord(value)) return null
  const path = str(value.path)
  if (!path || (value.kind !== 'A' && value.kind !== 'M')) return null
  const by = str(value.by)
  return { path, kind: value.kind, by, family: by ? modelFamily(by) : null, at: num(value.at) }
}

function parseCheck(value: unknown): OpsCheck | null {
  if (!isRecord(value)) return null
  if (value.kind !== 'build' && value.kind !== 'test') return null
  return {
    kind: value.kind,
    target: str(value.target),
    ok: value.ok === true,
    summary: str(value.summary),
    at: num(value.at)
  }
}

const limitRank = (key: string): number => (key === 'five_hour' ? 0 : key === 'seven_day' ? 1 : 2)

function parseLimits(value: unknown): RateLimitWindow[] {
  if (!Array.isArray(value)) return []
  const windows: RateLimitWindow[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const key = str(entry.kind)
    const percent = num(entry.percentUsed)
    if (!key || percent === null) continue
    const resets = typeof entry.resetsAt === 'string' ? Date.parse(entry.resetsAt) : num(entry.resetsAt)
    const family = perModelFamily(key)
    windows.push({
      key,
      label: family ?? rateLimitLabel(key),
      percent: clampPercent(percent),
      resetsAt: resets === null || Number.isNaN(resets) ? null : toMillis(resets),
      family: family ?? undefined
    })
  }
  return windows.sort((a, b) => limitRank(a.key) - limitRank(b.key))
}

function parsePlan(value: unknown): OpsSnapshot['plan'] {
  if (!isRecord(value)) return null
  const total = num(value.total)
  if (total === null || total < 0) return null
  const done = Math.min(total, Math.max(0, num(value.done) ?? 0))
  return { title: str(value.title), done, total }
}

function parseContext(value: unknown): OpsSnapshot['context'] {
  if (!isRecord(value)) return null
  const percent = num(value.percent)
  return {
    percent: percent === null ? null : clampPercent(percent),
    tokens: num(value.tokens),
    window: num(value.window),
    stage: str(value.stage)
  }
}

function parseCache(value: unknown): OpsSnapshot['cache'] {
  if (!isRecord(value)) return null
  const phase = CACHE_PHASES.find((p) => p === value.phase)
  if (!phase) return null
  const hit = num(value.hitPercent)
  return { phase, leftMs: num(value.leftMs), hitPercent: hit === null ? null : clampPercent(hit) }
}

function list<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  return value.map(parse).filter((item): item is T => item !== null)
}

export function parseOpsSnapshot(text: string): OpsSnapshot | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.v !== 1) return null
  const sessionId = str(raw.sessionId)
  const updatedAt = num(raw.updatedAt)
  if (!sessionId || updatedAt === null) return null
  const model = str(raw.model)
  return {
    sessionId,
    cwd: str(raw.cwd),
    updatedAt: toMillis(updatedAt),
    ended: raw.ended === true,
    model,
    family: modelFamily(model),
    plan: parsePlan(raw.plan),
    agents: list(raw.agents, parseAgent),
    advisor: parseAdvisor(raw.advisor),
    context: parseContext(raw.context),
    compactions: num(raw.compactions),
    cache: parseCache(raw.cache),
    limits: parseLimits(raw.limits),
    files: list(raw.files, parseFile).slice(-MAX_FILES),
    checks: list(raw.checks, parseCheck)
  }
}

export function opsModelLabel(model: string | null): string | null {
  if (!model) return null
  const match = /(opus|sonnet|haiku|fable)[-\s]?(\d+)?(?:[-.](\d+))?/i.exec(model)
  if (!match) return model
  const name = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
  const version = match[2] ? (match[3] ? `${match[2]}.${match[3]}` : match[2]) : ''
  return version ? `${name} ${version}` : name
}

export function runningFamilies(snapshot: OpsSnapshot): ModelFamily[] {
  return snapshot.agents.filter((a) => a.status === 'running').map((a) => a.family ?? 'other')
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

export type RowMarker = '[x]' | '[~]' | '[!]' | '[ ]'

export interface DrawerRow {
  id: string
  marker: RowMarker
  status: AgentStatus
  description: string
  modelLabel: string
  family: ModelFamily | null
  elapsed: string
  tokens: string
  detail: string | null
}

const MARKERS: Record<AgentStatus, RowMarker> = {
  done: '[x]',
  running: '[~]',
  failed: '[!]',
  waiting: '[ ]'
}

export function agentElapsedMs(agent: OpsAgent, now: number): number | null {
  if (agent.startedAt === null || agent.startedAt <= 0) return null
  if (agent.status === 'running') return now - agent.startedAt
  if (agent.status === 'waiting') return null
  return agent.finishedAt !== null && agent.finishedAt > 0 ? agent.finishedAt - agent.startedAt : null
}

export function drawerRow(agent: OpsAgent, now: number): DrawerRow {
  const elapsed = agentElapsedMs(agent, now)
  const finished = agent.status === 'done' || agent.status === 'failed'
  const running = agent.status === 'running'
  const parts: string[] = []
  if (running && agent.tools !== null) parts.push(`${agent.tools} tool${agent.tools === 1 ? '' : 's'}`)
  if (running && agent.lastStep) parts.push(`last: ${agent.lastStep}`)
  return {
    id: agent.id,
    marker: MARKERS[agent.status],
    status: agent.status,
    description: agent.description,
    modelLabel: agent.family && agent.family !== 'other' ? agent.family : '',
    family: agent.family,
    elapsed: elapsed === null ? '' : formatElapsed(elapsed),
    tokens: finished && agent.tokens !== null && agent.tokens > 0 ? formatTokens(agent.tokens) : '',
    detail: parts.length > 0 ? parts.join('   ') : null
  }
}

export type VerdictTone = 'ok' | 'warn' | 'bad' | 'muted'

export function verdictTone(verdict: string | null): VerdictTone {
  const value = (verdict ?? '').toLowerCase()
  if (value.startsWith('rethink')) return 'bad'
  if (value.includes('notes')) return 'warn'
  if (value.startsWith('ok')) return 'ok'
  return 'muted'
}

export function formatResets(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return ''
  const ms = resetsAt - now
  if (ms <= 0) return 'resets now'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 0 ? `resets in ${minutes}m` : `resets in ${hours}h ${minutes % 60}m`
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function formatLeft(ms: number | null): string {
  if (ms === null) return ''
  if (ms <= 0) return 'expired'
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m left`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
}

export function newestLimits(
  statuses: StatusInfo[],
  snapshots: OpsSnapshot[]
): { windows: RateLimitWindow[]; at: number } | null {
  let best: { windows: RateLimitWindow[]; at: number } | null = null
  const consider = (windows: RateLimitWindow[], at: number): void => {
    if (windows.length === 0) return
    if (!best || at > best.at) best = { windows, at }
  }
  for (const info of statuses) consider(info.rateLimits, info.receivedAt)
  for (const snapshot of snapshots) consider(snapshot.limits, snapshot.updatedAt)
  return best
}

export function latestCheck(checks: OpsCheck[], kind: OpsCheck['kind']): OpsCheck | null {
  let best: OpsCheck | null = null
  for (const check of checks) {
    if (check.kind !== kind) continue
    if (!best || (check.at ?? 0) >= (best.at ?? 0)) best = check
  }
  return best
}

export const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path
