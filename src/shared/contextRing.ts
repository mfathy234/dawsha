import { stepContextNote, type ContextReading, type NoteMemory } from './chatContext'
import { ringGeometry, ringStage, type RingGeometry, type RingStage } from './limitRings'
import { formatTokens } from './usage'

export const CONTEXT_RING_SIZE = 14
export const CONTEXT_RING_STROKE = 2

export interface ContextSegment {
  key: 'used' | 'free'
  label: string
  percent: number
  tokens: number | null
}

export interface ContextRingView {
  text: string
  stage: RingStage
  geometry: RingGeometry
  label: string
}

/** The header ring: the share in muted text, warm from 80% and red from 95%, the arc as long as the share. */
export function contextRingView(reading: ContextReading): ContextRingView {
  const stage = ringStage(reading.percent)
  const note = stage === 'danger' ? ', almost full' : stage === 'warn' ? ', getting full' : ''
  return {
    text: `${reading.percent}%`,
    stage,
    geometry: ringGeometry(reading.percent, CONTEXT_RING_SIZE, CONTEXT_RING_STROKE),
    label: `Context ${reading.percent}% used${note}. Show details`
  }
}

/** "41% of 200K used" when the window is known, else "41% used". */
export function contextUsedLine(reading: ContextReading): string {
  return reading.window ? `${reading.percent}% of ${formatTokens(reading.window)} used` : `${reading.percent}% used`
}

/** Only what the log really says: used and free. Counts appear when both the tokens and the window are known. */
export function contextSegments(reading: ContextReading): ContextSegment[] {
  const counted = reading.tokens !== null && reading.window !== null
  const used = Math.min(100, Math.max(0, reading.percent))
  const freeTokens = counted ? Math.max(0, (reading.window as number) - (reading.tokens as number)) : null
  return [
    { key: 'used', label: 'Used', percent: used, tokens: counted ? reading.tokens : null },
    { key: 'free', label: 'Free', percent: 100 - used, tokens: freeTokens }
  ]
}

export const segmentText = (segment: ContextSegment): string =>
  segment.tokens === null ? `${segment.label} ${segment.percent}%` : `${segment.label} ${formatTokens(segment.tokens)}`

export const contextWindowLine = (reading: ContextReading): string | null =>
  reading.window ? `Model window ${formatTokens(reading.window)} tokens` : null

export interface NudgeInput {
  percent: number | null
  /** The agent is asking for permission or showing a menu. */
  asking: boolean
  /** The Chat view is on screen, which has its own note. */
  chatShown: boolean
}

/** The line under a terminal pane's header past the warning line: once per crossing, never while the agent asks or in Chat. */
export function stepContextNudge(memory: NoteMemory, input: NudgeInput): { memory: NoteMemory; show: boolean } {
  const step = stepContextNote(memory, input.percent)
  return { memory: step.memory, show: step.show && !input.asking && !input.chatShown }
}

export const contextNudgeText = (percent: number): string =>
  `Context is ${Math.round(percent)}% full. Compact now so the agent does not do it mid-task.`
