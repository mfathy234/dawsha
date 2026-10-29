import { planName } from './agentAccounts'
import type { RateLimitWindow } from './types'

export interface CodexLimitsReading {
  windows: RateLimitWindow[]
  plan: string | null
  at: number | null
}

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function windowKey(minutes: number | null, slot: string): { key: string; label: string } {
  if (minutes === 300) return { key: 'five_hour', label: '5h' }
  if (minutes === 10_080) return { key: 'seven_day', label: 'week' }
  if (minutes === null || minutes <= 0) return { key: slot, label: 'limit' }
  const label = minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`
  return { key: `window_${minutes}m`, label }
}

function parseWindow(value: unknown, slot: string): RateLimitWindow | null {
  if (!isRecord(value)) return null
  const percent = finite(value.used_percent)
  if (percent === null) return null
  const resets = finite(value.resets_at)
  return {
    ...windowKey(finite(value.window_minutes), slot),
    percent: Math.min(100, Math.max(0, percent)),
    resetsAt: resets === null ? null : resets * 1000
  }
}

/** The newest token_count line that carries at least one window; the newest lines often report both as null. */
export function parseCodexLimits(text: string): CodexLimitsReading | null {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]
    if (!line.includes('rate_limits')) continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(raw) || raw.type !== 'event_msg' || !isRecord(raw.payload) || raw.payload.type !== 'token_count') continue
    const limits = raw.payload.rate_limits
    if (!isRecord(limits)) continue
    const windows = [parseWindow(limits.primary, 'primary'), parseWindow(limits.secondary, 'secondary')].filter((window): window is RateLimitWindow => window !== null)
    if (windows.length === 0) continue
    const stamp = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : NaN
    return { windows, plan: planName(limits.plan_type), at: Number.isFinite(stamp) ? stamp : null }
  }
  return null
}
