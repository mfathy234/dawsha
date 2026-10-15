import { parseResize, type CastEvent, type CastMarkerKind } from './cast'

export const IDLE_CAP_SECONDS = 1
export const SPEEDS = [1, 4, 16] as const
export type Speed = (typeof SPEEDS)[number]
export const DEFAULT_CHUNK_CHARS = 65_536
const MARKER_EPSILON = 0.05
const PREVIOUS_GRACE = 0.5

export interface Timeline {
  times: number[]
  total: number
}

export interface ReplayMarker {
  index: number
  t: number
  kind: CastMarkerKind
}

export type SeekStep = { type: 'resize'; cols: number; rows: number } | { type: 'write'; data: string }

export interface SeekPlan {
  reset: boolean
  steps: SeekStep[]
}

export function buildTimeline(events: CastEvent[], endAt: number, skipIdle: boolean, cap = IDLE_CAP_SECONDS): Timeline {
  const times = new Array<number>(events.length)
  let virtual = 0
  let previous = 0
  for (let index = 0; index < events.length; index += 1) {
    const gap = Math.max(0, events[index].t - previous)
    virtual += skipIdle ? Math.min(gap, cap) : gap
    times[index] = virtual
    previous = events[index].t
  }
  const tail = Math.max(0, endAt - previous)
  return { times, total: virtual + (skipIdle ? Math.min(tail, cap) : tail) }
}

export function eventCountAt(timeline: Timeline, position: number): number {
  let low = 0
  let high = timeline.times.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (timeline.times[mid] <= position) low = mid + 1
    else high = mid
  }
  return low
}

export const clampPosition = (timeline: Timeline, position: number): number =>
  Math.min(timeline.total, Math.max(0, position))

export const positionOfEvent = (timeline: Timeline, index: number): number =>
  timeline.times[Math.min(timeline.times.length - 1, Math.max(0, index))] ?? 0

export function advancePosition(timeline: Timeline, position: number, elapsedSeconds: number, speed: number): number {
  return clampPosition(timeline, position + Math.max(0, elapsedSeconds) * speed)
}

export function seekPlan(events: CastEvent[], from: number, to: number, chunkChars = DEFAULT_CHUNK_CHARS): SeekPlan {
  const end = Math.min(events.length, Math.max(0, to))
  const reset = end < from
  const steps: SeekStep[] = []
  let pending: string[] = []
  let size = 0
  const flush = (): void => {
    if (pending.length === 0) return
    steps.push({ type: 'write', data: pending.join('') })
    pending = []
    size = 0
  }
  for (let index = reset ? 0 : Math.max(0, from); index < end; index += 1) {
    const event = events[index]
    if (event.kind === 'o') {
      pending.push(event.data)
      size += event.data.length
      if (size >= chunkChars) flush()
    } else if (event.kind === 'r') {
      const next = parseResize(event.data)
      if (!next) continue
      flush()
      steps.push({ type: 'resize', cols: next.cols, rows: next.rows })
    }
  }
  flush()
  return { reset, steps }
}

export function recordedMarkers(events: CastEvent[]): ReplayMarker[] {
  const markers: ReplayMarker[] = []
  events.forEach((event, index) => {
    if (event.kind !== 'm') return
    if (event.data === 'prompt' || event.data === 'permission' || event.data === 'exit') {
      markers.push({ index, t: event.t, kind: event.data })
    }
  })
  return markers
}

export function mergeMarkers(...lists: ReplayMarker[][]): ReplayMarker[] {
  return lists.flat().sort((a, b) => a.index - b.index)
}

export function stepMarker(markers: ReplayMarker[], timeline: Timeline, position: number, direction: 1 | -1): number {
  if (direction === 1) {
    const next = markers.find((marker) => positionOfEvent(timeline, marker.index) > position + MARKER_EPSILON)
    return next ? positionOfEvent(timeline, next.index) : timeline.total
  }
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const at = positionOfEvent(timeline, markers[index].index)
    if (at < position - PREVIOUS_GRACE) return at
  }
  return 0
}

export function sizeAt(events: CastEvent[], count: number, initial: { cols: number; rows: number }): { cols: number; rows: number } {
  let size = initial
  for (let index = 0; index < Math.min(count, events.length); index += 1) {
    if (events[index].kind !== 'r') continue
    const next = parseResize(events[index].data)
    if (next) size = next
  }
  return size
}
