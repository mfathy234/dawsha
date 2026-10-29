import { describe, expect, it } from 'vitest'
import { cardSummary, formatResetIn, lastLines, sortByUrgency, limitText, limitRowLabel, moreLabel, stateWord, urgentWindow } from '../../src/shared/topbarSummary'
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

  it('labels the More button', () => {
    expect(moreLabel('agents')).toBe('More · Agent tools')
    expect(moreLabel('usage')).toBe('More · Usage')
    expect(moreLabel('grid')).toBe('More')
  })

  it('builds the state word', () => {
    expect(stateWord('needs', '2m')).toBe('needs you · 2m')
    expect(stateWord('idle', '')).toBe('idle')
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

describe('compact usage meter helpers', () => {
  it('picks the window with the highest percent, the first on a tie', () => {
    expect(urgentWindow([])).toBeNull()
    expect(urgentWindow([win('five_hour', 62), win('seven_day', 18)])?.key).toBe('five_hour')
    expect(urgentWindow([win('five_hour', 20), win('seven_day', 71)])?.key).toBe('seven_day')
    expect(urgentWindow([win('five_hour', 40), win('seven_day', 40)])?.key).toBe('five_hour')
  })

  it('labels a model-family window by its family', () => {
    expect(limitRowLabel(win('five_hour', 1))).toBe('five_hour')
    expect(limitRowLabel({ key: 'seven_day_opus', label: 'week opus', percent: 5, resetsAt: null, family: 'opus' })).toBe('Opus week')
    expect(limitRowLabel({ key: 'seven_day_fable', label: 'week fable', percent: 5, resetsAt: null, family: 'fable' })).toBe('Fable week')
    expect(limitRowLabel({ key: 'fable', label: 'fable', percent: 5, resetsAt: null, family: 'fable' })).toBe('Fable')
  })
})
