import { describe, expect, it } from 'vitest'
import { createLinkMachine, reconnectDelay, RECONNECT_DELAYS_MS } from '../../src/main/remoteLink'

describe('Remote Access link state machine', () => {
  it('walks off, connecting, on, dropped, reconnecting and back to on with a new link time', () => {
    let clock = 1000
    const link = createLinkMachine(() => clock)
    expect(link.snapshot()).toEqual({ phase: 'off', droppedAt: null, changedAt: null, attempt: 0 })
    expect(link.start()).toBe(true)
    expect(link.snapshot().phase).toBe('connecting')
    clock = 2000
    expect(link.up()).toBe(true)
    expect(link.snapshot()).toMatchObject({ phase: 'on', changedAt: 2000, droppedAt: null })
    clock = 5000
    expect(link.drop()).toBe(true)
    expect(link.snapshot()).toMatchObject({ phase: 'dropped', droppedAt: 5000, changedAt: 2000 })
    expect(link.reconnecting()).toBe(true)
    expect(link.snapshot()).toMatchObject({ phase: 'reconnecting', droppedAt: 5000 })
    clock = 9000
    expect(link.up()).toBe(true)
    expect(link.snapshot()).toEqual({ phase: 'on', droppedAt: null, changedAt: 9000, attempt: 0 })
  })

  it('keeps the first drop time while attempts fail and counts them', () => {
    let clock = 10
    const link = createLinkMachine(() => clock)
    link.start()
    link.up()
    clock = 20
    link.drop()
    clock = 30
    link.reconnecting()
    expect(link.attemptFailed()).toBe(true)
    expect(link.snapshot()).toMatchObject({ phase: 'dropped', droppedAt: 20, attempt: 1 })
    link.reconnecting()
    link.attemptFailed()
    expect(link.snapshot()).toMatchObject({ phase: 'dropped', droppedAt: 20, attempt: 2 })
  })

  it('recovers from a drop without changing the link time', () => {
    let clock = 1
    const link = createLinkMachine(() => clock)
    link.start()
    link.up()
    clock = 7
    link.drop()
    expect(link.recovered()).toBe(true)
    expect(link.snapshot()).toMatchObject({ phase: 'on', droppedAt: null, changedAt: 1 })
  })

  it('ignores moves that do not fit the current phase', () => {
    const link = createLinkMachine()
    expect(link.up()).toBe(false)
    expect(link.drop()).toBe(false)
    expect(link.recovered()).toBe(false)
    expect(link.attemptFailed()).toBe(false)
    link.start()
    link.up()
    expect(link.start()).toBe(false)
    expect(link.recovered()).toBe(false)
    expect(link.attemptFailed()).toBe(false)
    expect(link.snapshot().phase).toBe('on')
  })

  it('goes off from anywhere and forgets the history', () => {
    const link = createLinkMachine()
    link.start()
    link.up()
    link.drop()
    link.stop()
    expect(link.snapshot()).toEqual({ phase: 'off', droppedAt: null, changedAt: null, attempt: 0 })
  })
})

describe('reconnect backoff', () => {
  it('tries at once, then waits longer each time, and ends after the cap', () => {
    expect(reconnectDelay(0)).toBe(0)
    const delays = RECONNECT_DELAYS_MS.map((_, index) => reconnectDelay(index))
    expect(delays).toEqual([...delays].sort((a, b) => a! - b!))
    expect(reconnectDelay(RECONNECT_DELAYS_MS.length - 1)).toBeLessThanOrEqual(5 * 60_000)
    expect(reconnectDelay(RECONNECT_DELAYS_MS.length)).toBeNull()
  })

  it('rejects impossible attempt numbers and honours a custom schedule', () => {
    expect(reconnectDelay(-1)).toBeNull()
    expect(reconnectDelay(1.5)).toBeNull()
    expect(reconnectDelay(1, [0, 10])).toBe(10)
    expect(reconnectDelay(2, [0, 10])).toBeNull()
  })
})
