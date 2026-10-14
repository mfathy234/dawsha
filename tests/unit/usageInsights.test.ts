import { describe, expect, it } from 'vitest'
import type { UsageBucket, UsageReport } from '../../src/shared/usage'
import { formatDuration, limitPace, paceText, resetText } from '../../src/shared/usageLimits'
import { busiestBucket, changeText, nextSort, percentChange, previousTotals, sortRows, totalsOf } from '../../src/shared/usageSummary'

const MIN = 60_000
const NOW = 1_000_000_000_000

describe('limitPace', () => {
  it('projects when the limit will be reached', () => {
    const points = [
      { at: NOW - 60 * MIN, percent: 20 },
      { at: NOW, percent: 60 }
    ]
    const pace = limitPace(points, NOW + 4 * 3_600_000, NOW)
    expect(pace).toEqual({ kind: 'hit', minutes: 60 })
    expect(paceText(pace)).toBe('At this pace you reach 100% in about 1h')
  })

  it('is on track when the reset comes first', () => {
    const points = [
      { at: NOW - 60 * MIN, percent: 20 },
      { at: NOW, percent: 30 }
    ]
    expect(limitPace(points, NOW + 30 * MIN, NOW)).toEqual({ kind: 'ontrack' })
  })

  it('is on track when usage is flat', () => {
    const points = [
      { at: NOW - 30 * MIN, percent: 40 },
      { at: NOW, percent: 40 }
    ]
    expect(paceText(limitPace(points, null, NOW))).toBe('On track')
  })

  it('ignores readings from before the last reset', () => {
    const points = [
      { at: NOW - 80 * MIN, percent: 90 },
      { at: NOW - 40 * MIN, percent: 5 },
      { at: NOW, percent: 25 }
    ]
    expect(limitPace(points, null, NOW)).toEqual({ kind: 'hit', minutes: 150 })
  })

  it('has no pace without enough readings', () => {
    expect(limitPace([], null, NOW)).toBeNull()
    expect(limitPace([{ at: NOW, percent: 10 }], null, NOW)).toBeNull()
    const close = [
      { at: NOW - MIN, percent: 10 },
      { at: NOW, percent: 20 }
    ]
    expect(limitPace(close, null, NOW)).toBeNull()
    expect(paceText(null)).toBeNull()
  })

  it('reports a reached limit', () => {
    const points = [
      { at: NOW - 30 * MIN, percent: 80 },
      { at: NOW, percent: 100 }
    ]
    expect(paceText(limitPace(points, null, NOW))).toBe('Limit reached')
  })
})

describe('durations and resets', () => {
  it('formats minutes, hours and days', () => {
    expect(formatDuration(55)).toBe('55m')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(135)).toBe('2h 15m')
    expect(formatDuration(60 * 49)).toBe('2d 1h')
  })

  it('describes the reset time', () => {
    expect(resetText(null, NOW)).toBe('Reset time not reported')
    expect(resetText(NOW - 1, NOW)).toBe('Resets now')
    expect(resetText(NOW + 90 * MIN, NOW)).toBe('Resets in 1h 30m')
  })
})

const bucket = (key: string, tokens: number, cost: number | null = null): UsageBucket => ({
  key,
  perAgent: {
    claude: { tokens, costUsd: cost },
    codex: { tokens: 0, costUsd: null },
    gemini: { tokens: 0, costUsd: null }
  }
})

const report = (range: UsageReport['range'], buckets: UsageBucket[]): UsageReport => ({
  range,
  generatedAt: 0,
  start: 0,
  end: 0,
  hourly: range === 'today',
  buckets,
  byProject: [],
  byAgent: [
    { agent: 'claude', sessions: 2, tokens: buckets.reduce((sum, b) => sum + b.perAgent.claude.tokens, 0), cacheRead: 50, costUsd: null },
    { agent: 'codex', sessions: 1, tokens: 0, cacheRead: 5, costUsd: null },
    { agent: 'gemini', sessions: 0, tokens: 0, cacheRead: 0, costUsd: null }
  ],
  limits: [],
  hasCost: true,
  hasTokens: true,
  sources: []
})

describe('usage summary', () => {
  it('totals spend, tokens, cache reads and sessions', () => {
    const totals = totalsOf(report('7d', [bucket('a', 100, 1.5), bucket('b', 300, 2)]))
    expect(totals).toEqual({ costUsd: 3.5, tokens: 400, cacheRead: 55, sessions: 3 })
    expect(totalsOf(report('7d', [bucket('a', 1)])).costUsd).toBeNull()
  })

  it('finds the busiest bucket', () => {
    expect(busiestBucket(report('7d', [bucket('a', 100), bucket('b', 300), bucket('c', 200)]))).toEqual({ key: 'b', tokens: 300 })
    expect(busiestBucket(report('7d', [bucket('a', 0)]))).toBeNull()
  })

  it('compares 7 days with the 7 days before from a 30 day report', () => {
    const days = Array.from({ length: 30 }, (_, i) => bucket(`d${i}`, i < 23 ? 10 : 20, i >= 16 && i < 23 ? 1 : null))
    expect(previousTotals('7d', report('30d', days))).toEqual({ costUsd: 7, tokens: 70, cacheRead: 0, sessions: 0 })
    expect(previousTotals('30d', report('30d', days))).toBeNull()
    expect(previousTotals('7d', null)).toBeNull()
  })

  it('computes and words the change', () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 100)).toBe(-50)
    expect(percentChange(5, 0)).toBeNull()
    expect(percentChange(null, 4)).toBeNull()
    expect(changeText(50)).toBe('Up 50% vs the previous 7 days')
    expect(changeText(-20)).toBe('Down 20% vs the previous 7 days')
    expect(changeText(0)).toBe('Same as the previous 7 days')
    expect(changeText(null)).toBeNull()
  })
})

describe('sorting', () => {
  type Key = 'name' | 'tokens' | 'cost'
  const rows = [
    { name: 'b', tokens: 5, cost: null as number | null },
    { name: 'a', tokens: 9, cost: 2 },
    { name: 'c', tokens: 1, cost: 7 }
  ]
  const value = (row: (typeof rows)[number], key: Key) => row[key]
  const names = (key: Key, direction: 'asc' | 'desc') => sortRows(rows, { key, direction }, value).map((r) => r.name)

  it('sorts numbers and keeps empty values last', () => {
    expect(names('tokens', 'desc')).toEqual(['a', 'b', 'c'])
    expect(names('cost', 'desc')).toEqual(['c', 'a', 'b'])
    expect(names('cost', 'asc')).toEqual(['a', 'c', 'b'])
  })

  it('sorts text and toggles direction', () => {
    expect(names('name', 'asc')).toEqual(['a', 'b', 'c'])
    const text: Key[] = ['name']
    const first = nextSort<Key>({ key: 'tokens', direction: 'desc' }, 'name', text)
    expect(first).toEqual({ key: 'name', direction: 'asc' })
    expect(nextSort(first, 'name', text)).toEqual({ key: 'name', direction: 'desc' })
    expect(nextSort(first, 'tokens', text)).toEqual({ key: 'tokens', direction: 'desc' })
  })
})
