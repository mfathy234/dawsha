import { describe, expect, it } from 'vitest'
import { RESET_JUMP_MS, detectLimitWarnings, warningDetail, warningTitle, type LimitReading, type WarnedWindows } from '../../src/shared/limitWarnings'
import type { RateLimitWindow } from '../../src/shared/types'

const win = (percent: number, resetsAt: number | null = 5_000_000, key = 'five_hour'): RateLimitWindow => ({ key, label: key, percent, resetsAt })
const read = (percent: number, resetsAt: number | null = 5_000_000, stale = false, key = 'five_hour'): LimitReading => ({ agent: 'claude', window: win(percent, resetsAt, key), stale })

function run(steps: LimitReading[][], start: WarnedWindows = {}): number[] {
  let warned = start
  return steps.map((readings) => {
    const result = detectLimitWarnings(warned, readings)
    warned = result.warned
    return result.fire.length
  })
}

describe('limit warnings', () => {
  it('fires once when a window rises across 80 and stays quiet while it stays above', () => {
    expect(run([[read(60)], [read(79)], [read(80)], [read(84)], [read(99)]])).toEqual([0, 0, 1, 0, 0])
  })

  it('fires again after the window dropped below 80 and crossed again', () => {
    expect(run([[read(85)], [read(40)], [read(82)]])).toEqual([1, 0, 1])
  })

  it('re-arms when the window resets', () => {
    const next = 5_000_000 + 5 * 3_600_000
    expect(run([[read(85)], [read(90, next)]])).toEqual([1, 1])
  })

  it('treats a small shift of the reset time as the same window', () => {
    expect(run([[read(85)], [read(86, 5_000_000 + RESET_JUMP_MS - 1)]])).toEqual([1, 0])
  })

  it('warns separately for each window and each agent', () => {
    const both = [read(85), read(90, 6_000_000, false, 'seven_day')]
    expect(run([both, both])).toEqual([2, 0])
    expect(detectLimitWarnings({}, [{ ...read(85), agent: 'codex' }, read(85)]).fire).toHaveLength(2)
  })

  it('warns on a first reading already above 80 unless the saved state says this window was warned', () => {
    expect(run([[read(90)]])).toEqual([1])
    const saved = detectLimitWarnings({}, [read(90)]).warned
    expect(run([[read(90)]], saved)).toEqual([0])
  })

  it('never fires or changes anything for stale data', () => {
    const result = detectLimitWarnings({}, [read(95, 5_000_000, true)])
    expect(result.fire).toEqual([])
    expect(result.warned).toEqual({})
    const warned = detectLimitWarnings({}, [read(90)]).warned
    expect(detectLimitWarnings(warned, [read(10, 5_000_000, true)]).warned).toBe(warned)
  })

  it('keeps the same state object when nothing changed', () => {
    const warned = detectLimitWarnings({}, [read(90)]).warned
    expect(detectLimitWarnings(warned, [read(91)]).warned).toBe(warned)
    expect(detectLimitWarnings({}, [read(10)]).warned).toEqual({})
  })

  it('words the notification', () => {
    const now = 1_000_000
    const window = win(84, now + 72 * 60_000)
    expect(warningTitle('Claude', window)).toBe("Claude's 5-hour limit is at 84%")
    expect(warningDetail(window, now)).toBe('Resets in 1h 12m. Sessions keep running.')
    expect(warningDetail(win(84, null), now)).toBe('Sessions keep running.')
  })
})
