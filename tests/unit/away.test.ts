import { describe, expect, it } from 'vitest'
import { AWAY_MIN_MS, awayLength, catchUpHeadline, catchUpRows, catchUpWanted, initialAway, isAwayChange, limitSentence, stepAway, type CatchUpSession } from '../../src/shared/away'

const here = { windowFocused: true, locked: false, suspended: false, idleSeconds: 0 }

describe('away detection', () => {
  it('leaves when the window loses focus and returns when it gets it back', () => {
    const left = stepAway(initialAway(), { ...here, windowFocused: false }, 1000)
    expect(left.change).toEqual({ away: true, since: 1000 })
    expect(stepAway(left.memory, { ...here, windowFocused: false }, 2000).change).toBeNull()
    expect(stepAway(left.memory, here, 9000)).toEqual({ memory: { since: null }, change: { away: false, since: 1000 } })
  })

  it('counts a lock, a sleep and a long idle, dating the idle from when it began', () => {
    expect(stepAway(initialAway(), { ...here, locked: true }, 5).change?.away).toBe(true)
    expect(stepAway(initialAway(), { ...here, suspended: true }, 5).change?.away).toBe(true)
    expect(stepAway(initialAway(), { ...here, idleSeconds: 299 }, 5).change).toBeNull()
    expect(stepAway(initialAway(), { ...here, idleSeconds: 600 }, 1_000_000).change).toEqual({ away: true, since: 400_000 })
  })

  it('checks the payload shape', () => {
    expect(isAwayChange({ away: true, since: 1 })).toBe(true)
    expect(isAwayChange({ away: 'y', since: 1 })).toBe(false)
    expect(isAwayChange(null)).toBe(false)
  })
})

describe('catch-up', () => {
  const session = (paneId: string, patch: Partial<CatchUpSession>): CatchUpSession => ({ paneId, name: paneId, state: 'idle', unread: false, since: 0, line: `${paneId} line`, worked: false, ciFailed: '', changed: null, ...patch })

  it('lists what needs you, then what finished unseen, then failed checks', () => {
    const now = 40 * 60_000
    const rows = catchUpRows([session('done', { state: 'done', unread: true }), session('ci', { ciFailed: 'build 8812 failed' }), session('needs', { state: 'needs', since: 2 * 60_000 }), session('quiet', {}), session('seen', { state: 'done' })], now)
    expect(rows.map((row) => [row.paneId, row.kind])).toEqual([['needs', 'needs'], ['done', 'done'], ['ci', 'ci']])
    expect(rows[0].label).toBe('Needs you · 38m')
    expect(rows[2].what).toBe('build 8812 failed')
  })

  it('says how long, how many worked and how the limit moved', () => {
    expect(awayLength(112 * 60_000)).toBe('1h 52m')
    expect(awayLength(2 * 3_600_000)).toBe('2h')
    expect(awayLength(38 * 60_000)).toBe('38m')
    expect(limitSentence(31.2, 58.4)).toBe('5h limit went from 31% to 58%')
    expect(limitSentence(31, 31)).toBe('')
    expect(limitSentence(null, 5)).toBe('')
    expect(catchUpHeadline(112 * 60_000, 5, '5h limit went from 31% to 58%')).toBe('1h 52m · 5 sessions worked · 5h limit went from 31% to 58%')
    expect(catchUpHeadline(30 * 60_000, 1, '')).toBe('30m · 1 session worked')
  })

  it('shows only after 20 minutes, when on and when something happened', () => {
    const row = [{ paneId: 'a', kind: 'done' as const, label: 'Done', name: 'a', what: '' }]
    expect(catchUpWanted(AWAY_MIN_MS, true, row)).toBe(true)
    expect(catchUpWanted(AWAY_MIN_MS - 1, true, row)).toBe(false)
    expect(catchUpWanted(AWAY_MIN_MS, false, row)).toBe(false)
    expect(catchUpWanted(AWAY_MIN_MS, true, [])).toBe(false)
  })
})
