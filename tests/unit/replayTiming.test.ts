import { describe, expect, it } from 'vitest'
import type { CastEvent } from '../../src/shared/cast'
import {
  advancePosition,
  buildTimeline,
  clampPosition,
  eventCountAt,
  mergeMarkers,
  positionOfEvent,
  recordedMarkers,
  seekPlan,
  sizeAt,
  stepMarker
} from '../../src/shared/replayTiming'

const out = (t: number, data: string): CastEvent => ({ t, kind: 'o', data })
const events: CastEvent[] = [out(0.5, 'a'), out(1, 'b'), out(11, 'c'), out(11.5, 'd'), out(30, 'e')]

describe('timeline and idle skipping', () => {
  it('keeps recorded times when idle skipping is off', () => {
    const timeline = buildTimeline(events, 31, false)
    expect(timeline.times).toEqual([0.5, 1, 11, 11.5, 30])
    expect(timeline.total).toBe(31)
  })

  it('caps every gap at one second when skipping idle time', () => {
    const timeline = buildTimeline(events, 31, true)
    expect(timeline.times).toEqual([0.5, 1, 2, 2.5, 3.5])
    expect(timeline.total).toBe(4.5)
  })

  it('never makes a short gap longer', () => {
    const timeline = buildTimeline([out(0.2, 'a'), out(0.4, 'b')], 0.4, true)
    expect(timeline.times).toEqual([0.2, 0.4])
    expect(timeline.total).toBe(0.4)
  })

  it('handles an empty recording', () => {
    expect(buildTimeline([], 0, true)).toEqual({ times: [], total: 0 })
    expect(eventCountAt({ times: [], total: 0 }, 5)).toBe(0)
  })

  it('counts the events due at a position, including ties', () => {
    const timeline = buildTimeline(events, 31, false)
    expect(eventCountAt(timeline, 0)).toBe(0)
    expect(eventCountAt(timeline, 0.5)).toBe(1)
    expect(eventCountAt(timeline, 10.99)).toBe(2)
    expect(eventCountAt(timeline, 11)).toBe(3)
    expect(eventCountAt(timeline, 999)).toBe(5)
  })

  it('advances by elapsed time times speed and clamps to the ends', () => {
    const timeline = buildTimeline(events, 31, false)
    expect(advancePosition(timeline, 1, 2, 4)).toBe(9)
    expect(advancePosition(timeline, 30, 5, 16)).toBe(31)
    expect(advancePosition(timeline, 1, -3, 1)).toBe(1)
    expect(clampPosition(timeline, -2)).toBe(0)
  })

  it('maps an event index to its position', () => {
    const timeline = buildTimeline(events, 31, true)
    expect(positionOfEvent(timeline, 2)).toBe(2)
    expect(positionOfEvent(timeline, 99)).toBe(3.5)
  })
})

describe('seek planning', () => {
  const mixed: CastEvent[] = [
    out(0.1, 'one'),
    { t: 0.2, kind: 'r', data: '100x40' },
    out(0.3, 'two'),
    { t: 0.4, kind: 'm', data: 'prompt' },
    out(0.5, 'three')
  ]

  it('plays forward from where it is without a reset', () => {
    const plan = seekPlan(mixed, 2, 5)
    expect(plan.reset).toBe(false)
    expect(plan.steps).toEqual([{ type: 'write', data: 'twothree' }])
  })

  it('resets and replays from the start when seeking backwards', () => {
    const plan = seekPlan(mixed, 5, 3)
    expect(plan.reset).toBe(true)
    expect(plan.steps).toEqual([
      { type: 'write', data: 'one' },
      { type: 'resize', cols: 100, rows: 40 },
      { type: 'write', data: 'two' }
    ])
  })

  it('splits long output into chunks so the UI can breathe between writes', () => {
    const many = Array.from({ length: 10 }, (_, i) => out(i, 'x'.repeat(100)))
    const plan = seekPlan(many, 0, 10, 300)
    expect(plan.steps.map((step) => (step.type === 'write' ? step.data.length : 0))).toEqual([300, 300, 300, 100])
  })

  it('ignores markers and invalid resizes and does nothing when already there', () => {
    const odd: CastEvent[] = [{ t: 0, kind: 'r', data: 'nope' }, { t: 1, kind: 'm', data: 'prompt' }]
    expect(seekPlan(odd, 0, 2).steps).toEqual([])
    expect(seekPlan(mixed, 3, 3)).toEqual({ reset: false, steps: [] })
  })

  it('reports the recorded size after a number of events', () => {
    expect(sizeAt(mixed, 1, { cols: 80, rows: 24 })).toEqual({ cols: 80, rows: 24 })
    expect(sizeAt(mixed, 5, { cols: 80, rows: 24 })).toEqual({ cols: 100, rows: 40 })
  })
})

describe('markers', () => {
  const marked: CastEvent[] = [
    out(0.1, 'a'),
    { t: 1, kind: 'm', data: 'prompt' },
    out(1.5, 'b'),
    { t: 4, kind: 'm', data: 'permission' },
    { t: 4.2, kind: 'm', data: 'weird' },
    { t: 9, kind: 'm', data: 'exit' }
  ]
  const timeline = buildTimeline(marked, 9, false)
  const markers = recordedMarkers(marked)

  it('reads recorded markers and ignores unknown ones', () => {
    expect(markers).toEqual([
      { index: 1, t: 1, kind: 'prompt' },
      { index: 3, t: 4, kind: 'permission' },
      { index: 5, t: 9, kind: 'exit' }
    ])
  })

  it('jumps to the next marker, or to the end when there is none', () => {
    expect(stepMarker(markers, timeline, 0, 1)).toBe(1)
    expect(stepMarker(markers, timeline, 1, 1)).toBe(4)
    expect(stepMarker(markers, timeline, 9, 1)).toBe(9)
  })

  it('jumps to the previous marker, with a short grace so repeated presses keep moving', () => {
    expect(stepMarker(markers, timeline, 9, -1)).toBe(4)
    expect(stepMarker(markers, timeline, 4.2, -1)).toBe(1)
    expect(stepMarker(markers, timeline, 1.2, -1)).toBe(0)
    expect(stepMarker(markers, timeline, 4.3, -1)).toBe(1)
    expect(stepMarker(markers, timeline, 4.7, -1)).toBe(4)
  })

  it('reads pause, resume and size-limit markers', () => {
    const extra: CastEvent[] = [
      { t: 1, kind: 'm', data: 'paused' },
      { t: 2, kind: 'm', data: 'resumed' },
      { t: 3, kind: 'm', data: 'truncated' }
    ]
    expect(recordedMarkers(extra).map((marker) => marker.kind)).toEqual(['paused', 'resumed', 'truncated'])
  })

  it('merges marker lists in event order', () => {
    const merged = mergeMarkers([{ index: 5, t: 9, kind: 'exit' }], [{ index: 2, t: 1.2, kind: 'permission' }])
    expect(merged.map((marker) => marker.index)).toEqual([2, 5])
  })
})
