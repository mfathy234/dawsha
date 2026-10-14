export interface LimitPoint {
  at: number
  percent: number
}

export type LimitPace = { kind: 'hit'; minutes: number } | { kind: 'ontrack' } | null

export const PACE_LOOKBACK_MS = 90 * 60_000
export const PACE_MIN_SPAN_MS = 5 * 60_000
export const PACE_MIN_RISE = 1

function currentCycle(points: LimitPoint[]): LimitPoint[] {
  let start = 0
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].percent < points[index - 1].percent - 0.5) start = index
  }
  return points.slice(start)
}

export function limitPace(points: LimitPoint[], resetsAt: number | null, now: number): LimitPace {
  const sorted = [...points].sort((a, b) => a.at - b.at)
  const cycle = currentCycle(sorted).filter((point) => point.at >= now - PACE_LOOKBACK_MS && point.at <= now)
  if (cycle.length < 2) return null
  const first = cycle[0]
  const last = cycle[cycle.length - 1]
  const span = last.at - first.at
  if (span < PACE_MIN_SPAN_MS) return null
  if (last.percent >= 100) return { kind: 'hit', minutes: 0 }
  const rise = last.percent - first.percent
  if (rise < PACE_MIN_RISE) return { kind: 'ontrack' }
  const msToFull = ((100 - last.percent) / rise) * span - (now - last.at)
  const remaining = Math.max(0, msToFull)
  if (resetsAt !== null && now + remaining >= resetsAt) return { kind: 'ontrack' }
  return { kind: 'hit', minutes: Math.max(1, Math.round(remaining / 60_000)) }
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

export function paceText(pace: LimitPace): string | null {
  if (pace === null) return null
  if (pace.kind === 'ontrack') return 'On track'
  return pace.minutes === 0 ? 'Limit reached' : `At this pace you reach 100% in about ${formatDuration(pace.minutes)}`
}

export function resetText(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return 'Reset time not reported'
  const ms = resetsAt - now
  if (ms <= 0) return 'Resets now'
  return `Resets in ${formatDuration(Math.max(1, Math.round(ms / 60_000)))}`
}
