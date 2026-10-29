import { describe, expect, it } from 'vitest'
import { createActivityLog, describeActivity, MAX_REMOTE_ACTIVITY } from '../../src/shared/remoteActivity'

describe('phone activity log', () => {
  it('lists the newest action first with a time', () => {
    let clock = 100
    const log = createActivityLog(() => clock)
    log.record({ device: 'Pixel 9', action: 'approved', session: 'billing-api', detail: 'npm test' })
    clock = 200
    log.record({ device: 'Pixel 9', action: 'message', session: 'Claude · billing-api', detail: '' })
    expect(log.list().map((entry) => [entry.action, entry.time])).toEqual([['message', 200], ['approved', 100]])
  })

  it('keeps only the last 50 and can limit what it lists', () => {
    let clock = 0
    const log = createActivityLog(() => (clock += 60_000))
    for (let index = 0; index < 80; index++) log.record({ device: 'Pixel 9', action: 'approved', session: 'p', detail: `command ${index}` })
    expect(MAX_REMOTE_ACTIVITY).toBe(50)
    expect(log.list()).toHaveLength(50)
    expect(log.list()[0]!.detail).toBe('command 79')
    expect(log.list(10)).toHaveLength(10)
    expect(log.list(0)).toEqual([])
  })

  it('folds an identical action from the same phone within a few seconds into one line', () => {
    let clock = 1000
    const log = createActivityLog(() => clock)
    const input = { device: 'Pixel 9', action: 'message' as const, session: 'Claude · api', detail: '' }
    log.record(input)
    clock += 2000
    log.record(input)
    clock += 20_000
    log.record(input)
    log.record({ ...input, device: 'iPad mini' })
    expect(log.list()).toHaveLength(3)
  })

  it('describes each action as a plain sentence naming the phone', () => {
    const entry = { id: '1', time: 0, device: 'Pixel 9', session: 'billing-api', detail: 'npm test' }
    expect(describeActivity({ ...entry, action: 'approved' })).toBe('Pixel 9 allowed npm test in billing-api')
    expect(describeActivity({ ...entry, action: 'denied' })).toBe('Pixel 9 denied npm test in billing-api')
    expect(describeActivity({ ...entry, action: 'paired', session: null })).toBe('Pixel 9 paired with this PC')
    expect(describeActivity({ ...entry, action: 'blocked', detail: 'sending a message' })).toBe('Pixel 9 was blocked from sending a message in billing-api')
    expect(describeActivity({ ...entry, action: 'session-started', session: null })).toBe('Pixel 9 started a session')
  })
})
