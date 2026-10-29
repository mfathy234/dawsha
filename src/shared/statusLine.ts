import type { ModelFamily, RateLimitWindow, StatusInfo } from './types'

type Raw = Record<string, unknown>

const GAUGE_CELLS = 5
const FILLED = '▰'
const EMPTY = '▱'

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

export function modelFamily(text: string | null | undefined): ModelFamily {
  const value = (text ?? '').toLowerCase()
  if (value.includes('opus')) return 'opus'
  if (value.includes('sonnet')) return 'sonnet'
  if (value.includes('haiku')) return 'haiku'
  if (value.includes('fable')) return 'fable'
  if (/\bgpt\b|codex|\bo[1-9]\b/.test(value)) return 'codex'
  if (value.includes('gemini')) return 'gemini'
  return 'other'
}

export function shortModelName(displayName: string | null, id: string | null): string | null {
  const name = displayName?.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  return name || id
}

export function rateLimitLabel(key: string): string {
  if (key === 'five_hour') return '5h'
  if (key === 'seven_day') return 'week'
  return key
    .replace(/^five_hour_?/, '5h ')
    .replace(/^seven_day_?/, 'week ')
    .replace(/_/g, ' ')
    .trim()
}

const labelRank = (key: string): number => (key === 'five_hour' ? 0 : key === 'seven_day' ? 1 : 2)

export const toMillis = (epoch: number): number => (epoch < 100_000_000_000 ? epoch * 1000 : epoch)

export function limitWindow(key: string, percent: number, resetsAt: number | null): RateLimitWindow {
  const family = modelFamily(key)
  return {
    key,
    label: rateLimitLabel(key),
    family: ['opus', 'sonnet', 'haiku', 'fable'].includes(family) ? family : undefined,
    percent: Math.min(100, Math.max(0, percent)),
    resetsAt
  }
}

function parseRateLimits(value: unknown): RateLimitWindow[] {
  if (!isRecord(value)) return []
  const windows: RateLimitWindow[] = []
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue
    const percent = asNumber(entry.used_percentage)
    if (percent === null) continue
    const resets = asNumber(entry.resets_at)
    const family = modelFamily(key)
    windows.push({
      key,
      label: rateLimitLabel(key),
      family: ['opus', 'sonnet', 'haiku', 'fable'].includes(family) ? family : undefined,
      percent: Math.min(100, Math.max(0, percent)),
      resetsAt: resets === null ? null : toMillis(resets)
    })
  }
  return windows.sort((a, b) => labelRank(a.key) - labelRank(b.key))
}

export function parseStatusPayload(text: string, receivedAt: number): StatusInfo | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  const sessionId = asString(raw.session_id)
  if (!sessionId) return null
  const model = isRecord(raw.model) ? raw.model : {}
  const modelId = asString(model.id)
  const displayName = asString(model.display_name)
  const cost = isRecord(raw.cost) ? asNumber(raw.cost.total_cost_usd) : null
  const context = isRecord(raw.context_window) ? asNumber(raw.context_window.used_percentage) : null
  return {
    sessionId,
    modelId,
    modelName: shortModelName(displayName, modelId),
    family: modelFamily(modelId ?? displayName),
    cwd: asString(raw.cwd),
    costUsd: cost,
    contextPercent: context === null ? null : Math.min(100, Math.max(0, context)),
    rateLimits: parseRateLimits(raw.rate_limits),
    receivedAt
  }
}

export function gauge(percent: number, cells: number = GAUGE_CELLS): string {
  const filled = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  return FILLED.repeat(filled) + EMPTY.repeat(cells - filled)
}

export function gaugeParts(percent: number, cells: number = GAUGE_CELLS): { filled: string; empty: string } {
  const count = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  return { filled: FILLED.repeat(count), empty: EMPTY.repeat(cells - count) }
}

export type GaugeStage = 'ok' | 'warn' | 'high' | 'critical'

export function gaugeStage(percent: number): GaugeStage {
  if (percent >= 90) return 'critical'
  if (percent >= 80) return 'high'
  if (percent >= 70) return 'warn'
  return 'ok'
}

export const formatCost = (usd: number): string => `$${usd.toFixed(2)}`

export const formatPercent = (percent: number): string => `${Math.round(percent)}%`

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function newestWithLimits(infos: StatusInfo[]): StatusInfo | null {
  let best: StatusInfo | null = null
  for (const info of infos) {
    if (info.rateLimits.length === 0) continue
    if (!best || info.receivedAt > best.receivedAt) best = info
  }
  return best
}
