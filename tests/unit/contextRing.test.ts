import { describe, expect, it } from 'vitest'
import { contextRingView, contextSegments, contextUsedLine, contextWindowLine, segmentText, contextNudgeText, stepContextNudge } from '../../src/shared/contextRing'

const reading = (percent: number, tokens: number | null = null, window: number | null = null) => ({ percent, tokens, window })

describe('contextRingView', () => {
  it('stays plain under 80, warm from 80 and red from 95', () => {
    expect(contextRingView(reading(41)).stage).toBe('ok')
    expect(contextRingView(reading(79)).stage).toBe('ok')
    expect(contextRingView(reading(80)).stage).toBe('warn')
    expect(contextRingView(reading(94)).stage).toBe('warn')
    expect(contextRingView(reading(95)).stage).toBe('danger')
  })

  it('shows the share and a spoken label', () => {
    const view = contextRingView(reading(41))
    expect(view.text).toBe('41%')
    expect(view.label).toBe('Context 41% used. Show details')
    expect(contextRingView(reading(96)).label).toContain('almost full')
  })

  it('draws an arc as long as the share', () => {
    const { geometry } = contextRingView(reading(50))
    expect(geometry.dashOffset).toBeCloseTo(geometry.circumference / 2)
  })
})

describe('contextUsedLine and window', () => {
  it('names the window when known', () => {
    expect(contextUsedLine(reading(41, 82_000, 200_000))).toBe('41% of 200K used')
    expect(contextWindowLine(reading(41, 82_000, 200_000))).toBe('Model window 200K tokens')
  })

  it('falls back to the share alone', () => {
    expect(contextUsedLine(reading(41))).toBe('41% used')
    expect(contextWindowLine(reading(41))).toBeNull()
  })
})

describe('contextSegments', () => {
  it('splits into used and free with counts when known', () => {
    const [used, free] = contextSegments(reading(41, 82_000, 200_000))
    expect(used).toEqual({ key: 'used', label: 'Used', percent: 41, tokens: 82_000 })
    expect(free).toEqual({ key: 'free', label: 'Free', percent: 59, tokens: 118_000 })
    expect(segmentText(used)).toBe('Used 82K')
  })

  it('uses shares when there are no counts', () => {
    const [used, free] = contextSegments(reading(30))
    expect(segmentText(used)).toBe('Used 30%')
    expect(segmentText(free)).toBe('Free 70%')
  })

  it('never lets free go below zero', () => {
    expect(contextSegments(reading(100, 210_000, 200_000))[1].tokens).toBe(0)
  })
})

describe('stepContextNudge', () => {
  const open = { asking: false, chatShown: false }
  it('shows from 85 and says the share in plain words', () => {
    expect(stepContextNudge({ dismissed: false }, { ...open, percent: 84 }).show).toBe(false)
    expect(stepContextNudge({ dismissed: false }, { ...open, percent: 87 }).show).toBe(true)
    expect(contextNudgeText(86.6)).toBe('Context is 87% full. Compact now so the agent does not do it mid-task.')
  })

  it('stays hidden after a dismissal until the context falls below the line and crosses again', () => {
    let memory = { dismissed: true }
    expect(stepContextNudge(memory, { ...open, percent: 92 })).toEqual({ memory, show: false })
    memory = stepContextNudge(memory, { ...open, percent: 40 }).memory
    expect(memory.dismissed).toBe(false)
    expect(stepContextNudge(memory, { ...open, percent: 88 }).show).toBe(true)
  })

  it('never shows while the agent asks, nor in Chat, and keeps the crossing for later', () => {
    const memory = { dismissed: false }
    expect(stepContextNudge(memory, { percent: 90, asking: true, chatShown: false }).show).toBe(false)
    expect(stepContextNudge(memory, { percent: 90, asking: false, chatShown: true }).show).toBe(false)
    expect(stepContextNudge(memory, { percent: 90, asking: false, chatShown: false }).show).toBe(true)
  })

  it('shows nothing without a reading', () => {
    expect(stepContextNudge({ dismissed: false }, { ...open, percent: null }).show).toBe(false)
  })
})
