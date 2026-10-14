import { describe, expect, it } from 'vitest'
import { accountLimits, cardSummary, formatResetIn, lastLines, sortByUrgency, isMoreView, limitText, moreLabel, stateWord } from '../../src/shared/topbarSummary'
import type { RateLimitWindow } from '../../src/shared/types'

const win = (key: string, percent: number, resetsAt: number | null = null): RateLimitWindow => ({ key, label: key, percent, resetsAt })

describe('topbar summary helpers', () => {
  it('formats the time until a reset', () => {
    const now = 1_000_000
    expect(formatResetIn(now + 99 * 60_000, now)).toBe('1h 39m')
    expect(formatResetIn(now + 39 * 60_000 + 5000, now)).toBe('39m')
    expect(formatResetIn(now + 51 * 3_600_000, now)).toBe('2d 3h')
    expect(formatResetIn(now - 1000 * 60, now)).toBeNull()
    expect(formatResetIn(null, now)).toBeNull()
  })

  it('adds the reset time only to the 5h window', () => {
    const now = 0
    expect(limitText(win('five_hour', 62, 99 * 60_000), now)).toBe('62% · 1h 39m')
    expect(limitText(win('seven_day', 30, 99 * 60_000), now)).toBe('30%')
    expect(limitText(win('five_hour', 62), now)).toBe('62%')
  })

  it('prefers the focused pane limits, else any pane with limits', () => {
    const a = [win('five_hour', 10), win('seven_day_opus', 5)]
    const b = [win('five_hour', 20), win('seven_day', 40)]
    expect(accountLimits([a, b], 1).map((w) => w.percent)).toEqual([20, 40])
    expect(accountLimits([[], b], 0).map((w) => w.percent)).toEqual([20, 40])
    expect(accountLimits([[], []], 0)).toEqual([])
  })

  it('labels the More button', () => {
    expect(moreLabel('agents')).toBe('More · Agents')
    expect(moreLabel('grid')).toBe('More')
    expect(isMoreView('layouts')).toBe(true)
    expect(isMoreView('usage')).toBe(false)
  })

  it('builds the state word', () => {
    expect(stateWord('needs', 125_000)).toBe('needs you · 2m')
    expect(stateWord('idle', null)).toBe('idle')
  })
})

describe('others panel helpers', () => {
  it('takes the last non-empty lines', () => {
    expect(lastLines('a\n\nb  \nc\n\n', 2)).toEqual(['b', 'c'])
    expect(lastLines('', 2)).toEqual([])
  })

  it('sorts most urgent first and keeps order within a state', () => {
    const sorted = sortByUrgency([
      { id: 1, state: 'idle' as const },
      { id: 2, state: 'done' as const },
      { id: 3, state: 'needs' as const },
      { id: 4, state: 'done' as const }
    ])
    expect(sorted.map((e) => e.id)).toEqual([3, 2, 4, 1])
  })

  it('summarises from the plan title', () => {
    expect(cardSummary({ snapshot: { plan: { title: '  Fix  the\nbug ' } } })).toBe('Fix the bug')
    expect(cardSummary({ snapshot: null })).toBe('')
  })
})
