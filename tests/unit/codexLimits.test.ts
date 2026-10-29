import { describe, expect, it } from 'vitest'
import { parseCodexLimits } from '../../src/shared/codexLimits'

const line = (rateLimits: unknown, timestamp = '2026-10-29T10:00:00.000Z'): string =>
  JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rateLimits } })

const FULL = {
  primary: { used_percent: 99, window_minutes: 300, resets_at: 1793273411 },
  secondary: { used_percent: 15, window_minutes: 10080, resets_at: 1793860211 },
  plan_type: 'plus'
}

describe('parseCodexLimits', () => {
  it('reads the two windows, the plan and the timestamp', () => {
    const reading = parseCodexLimits(line(FULL))
    expect(reading?.plan).toBe('Plus')
    expect(reading?.at).toBe(Date.parse('2026-10-29T10:00:00.000Z'))
    expect(reading?.windows).toEqual([
      { key: 'five_hour', label: '5h', percent: 99, resetsAt: 1793273411000 },
      { key: 'seven_day', label: 'week', percent: 15, resetsAt: 1793860211000 }
    ])
  })

  it('skips newer lines whose windows are both null', () => {
    const text = [line(FULL, '2026-10-29T10:00:00.000Z'), line({ primary: null, secondary: null }, '2026-10-29T11:00:00.000Z')].join('\n')
    expect(parseCodexLimits(text)?.windows).toHaveLength(2)
    expect(parseCodexLimits(text)?.at).toBe(Date.parse('2026-10-29T10:00:00.000Z'))
  })

  it('takes one window when the other is null', () => {
    const reading = parseCodexLimits(line({ primary: FULL.primary, secondary: null }))
    expect(reading?.windows.map((window) => window.key)).toEqual(['five_hour'])
  })

  it('labels an unknown window length from its minutes', () => {
    const reading = parseCodexLimits(line({ primary: { used_percent: 5, window_minutes: 1440, resets_at: 1 }, secondary: { used_percent: 6, window_minutes: 90 } }))
    expect(reading?.windows.map((window) => window.label)).toEqual(['1d', '90m'])
    expect(reading?.windows[1].resetsAt).toBeNull()
  })

  it('survives missing fields, garbage and a cut first line', () => {
    expect(parseCodexLimits('')).toBeNull()
    expect(parseCodexLimits('not json rate_limits')).toBeNull()
    expect(parseCodexLimits(line({ primary: { window_minutes: 300 } }))).toBeNull()
    expect(parseCodexLimits(line({ primary: { used_percent: 'x' } }))).toBeNull()
    const noStamp = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 1 } } } })
    expect(parseCodexLimits(`{"cut":\n${noStamp}`)).toEqual({ windows: [{ key: 'primary', label: 'limit', percent: 1, resetsAt: null }], plan: null, at: null })
  })

  it('ignores other event types', () => {
    const other = JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', rate_limits: FULL } })
    expect(parseCodexLimits(other)).toBeNull()
  })
})
