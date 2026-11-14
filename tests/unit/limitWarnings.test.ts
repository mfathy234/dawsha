import { describe, expect, it } from 'vitest'
import { RESET_JUMP_MS, detectLimitWarnings, desktopWarningText, limitReadings, sanitizeWarnedWindows, warningDetail, warningTitle, type LimitReading, type WarnedWindows } from '../../src/shared/limitWarnings'
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
    expect(run([[read(60)], [read(79)], [read(80)], [read(84)], [read(94)], [read(95)], [read(99)]])).toEqual([0, 0, 1, 0, 0, 1, 0])
  })

  it('never re-arms either threshold after a percentage dip in the same window', () => {
    expect(run([[read(85)], [read(40)], [read(82)], [read(96)], [read(94)], [read(97)]])).toEqual([1, 0, 0, 1, 0, 0])
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

  it('emits one notice on a jump past both thresholds and remembers both after restart', () => {
    const result = detectLimitWarnings({}, [read(98)])
    expect(result.fire).toHaveLength(1)
    const saved = JSON.parse(JSON.stringify(result.warned))
    expect(run([[read(90)], [read(99)]], saved)).toEqual([0, 0])
  })

  it('keeps dedupe when a reset timestamp temporarily disappears and returns', () => {
    expect(run([[read(82)], [read(83, null)], [read(84)]])).toEqual([1, 0, 0])
  })

  it('does not notify for malformed percentages or unsupported agents and windows', () => {
    expect(detectLimitWarnings({}, [read(NaN), read(Infinity), { ...read(90), agent: 'gemini' }, read(90, null, false, 'seven_day_opus')]).fire).toEqual([])
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

  it('formats a desktop warning with the local reset time and handles unknown resets', () => {
    expect(desktopWarningText('Claude', win(82, new Date(2026, 10, 14, 18, 40).getTime()))).toBe('Claude is at 82% of its 5-hour limit. It resets at 18:40.')
    expect(desktopWarningText('Codex', win(96, null, 'seven_day'))).toBe('Codex is at 96% of its weekly limit. Reset time is not reported.')
  })

  it('marks expired windows and old readings stale independently', () => {
    const now = 10_000_000
    const readings = limitReadings({ claude: { at: now, windows: [win(99, now - 1), win(85, now + 1000, 'seven_day')] }, codex: { at: now - 31 * 60_000, windows: [win(90, now + 1000)] } }, now)
    expect(readings.map(r => r.stale)).toEqual([true, false, true])
    expect(detectLimitWarnings({}, readings).fire.map(r => r.window.key)).toEqual(['seven_day'])
  })

  it('sanitizes persisted dedupe state, discarding unrelated keys and malformed entries', () => {
    expect(sanitizeWarnedWindows({ 'claude:five_hour': { resetsAt: null, threshold: 95 }, 'codex:seven_day': { resetsAt: 5000000 }, 'claude:seven_day': { resetsAt: 'bad', threshold: 95 }, other: { resetsAt: null } })).toEqual({ 'claude:five_hour': { resetsAt: null, threshold: 95 }, 'codex:seven_day': { resetsAt: 5000000, threshold: 80 } })
    expect(sanitizeWarnedWindows(null)).toEqual({})
    expect(sanitizeWarnedWindows({ 'claude:five_hour': { resetsAt: Infinity }, 'codex:five_hour': { resetsAt: null, threshold: 100 } })).toEqual({})
  })
})
