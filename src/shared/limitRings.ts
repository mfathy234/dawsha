import type { RateLimitWindow } from './types'
import { formatPercent } from './statusLine'
import { formatResetIn, urgentWindow } from './topbarSummary'

export type RingStage = 'ok' | 'warn' | 'danger'

export const RING_WARN_AT = 80
export const RING_DANGER_AT = 95
export const RING_SIZE = 26
export const RING_SIZE_COMPACT = 18
export const RING_STROKE = 2.5
export const RING_STROKE_COMPACT = 2

/** Accent under 80%, amber from 80%, danger from 95%. The shared gaugeStage keeps its own 70/80/90 steps for the other gauges. */
export function ringStage(percent: number): RingStage {
  if (percent >= RING_DANGER_AT) return 'danger'
  if (percent >= RING_WARN_AT) return 'warn'
  return 'ok'
}

export interface RingGeometry {
  size: number
  center: number
  radius: number
  strokeWidth: number
  circumference: number
  /** How much of the arc stays empty; 0 is a full ring. */
  dashOffset: number
}

export function ringGeometry(percent: number, size: number = RING_SIZE, strokeWidth: number = RING_STROKE): RingGeometry {
  const safe = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  return { size, center: size / 2, radius, strokeWidth, circumference, dashOffset: circumference * (1 - safe / 100) }
}

/** The letters inside a ring: 5h, W for the week, or the first letter of the model family (O for Opus). */
export function ringLetter(window: RateLimitWindow): string {
  if (window.family) return window.family.charAt(0).toUpperCase()
  if (window.key === 'five_hour') return '5h'
  if (window.key === 'seven_day') return 'W'
  const first = window.label.trim().charAt(0)
  return first ? first.toUpperCase() : '?'
}

/** Plain name of a window for tooltips: "5-hour", "weekly", "Opus weekly". */
export function ringWindowName(window: RateLimitWindow): string {
  if (window.key === 'five_hour') return '5-hour'
  if (window.key === 'seven_day') return 'weekly'
  if (window.family) return `${window.family.charAt(0).toUpperCase()}${window.family.slice(1)} weekly`
  return window.label
}

/** "Claude 5-hour: 3%, resets in 4h 28m"; the reset part is left out when unknown or already past. */
export function ringTitle(agentName: string, window: RateLimitWindow, now: number): string {
  const reset = formatResetIn(window.resetsAt, now)
  return `${agentName} ${ringWindowName(window)}: ${formatPercent(window.percent)}${reset ? `, resets in ${reset}` : ''}`
}

export interface RingSpec {
  window: RateLimitWindow
  letter: string
  stage: RingStage
  title: string
  geometry: RingGeometry
  lettered: boolean
}

/** One ring per window the agent really reported, never an empty placeholder. Narrow bars keep only the highest window, unlettered and smaller. */
export function ringSpecs(agentName: string, windows: readonly RateLimitWindow[], now: number, compact: boolean): RingSpec[] {
  const shown = compact ? [urgentWindow([...windows])].filter((window): window is RateLimitWindow => window !== null) : windows.filter((window) => Number.isFinite(window.percent))
  const size = compact ? RING_SIZE_COMPACT : RING_SIZE
  const stroke = compact ? RING_STROKE_COMPACT : RING_STROKE
  return shown.map((window) => ({
    window,
    letter: ringLetter(window),
    stage: ringStage(window.percent),
    title: ringTitle(agentName, window, now),
    geometry: ringGeometry(window.percent, size, stroke),
    lettered: !compact
  }))
}
