import { describe, expect, it } from 'vitest'
import { InFlight, KeyedGate, LatestGate } from '../../src/renderer/files/asyncGuard'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('LatestGate', () => {
  it('keeps the newest ticket current and drops older ones', () => {
    const gate = new LatestGate()
    const first = gate.begin()
    expect(first.current()).toBe(true)
    const second = gate.begin()
    expect(first.current()).toBe(false)
    expect(second.current()).toBe(true)
  })
  it('cancel makes every ticket stale', () => {
    const gate = new LatestGate()
    const ticket = gate.begin()
    gate.cancel()
    expect(ticket.current()).toBe(false)
    expect(gate.begin().current()).toBe(true)
  })
  it('lets only the last of several out-of-order results win', async () => {
    const gate = new LatestGate()
    let shown = ''
    const load = async (name: string, wait: Promise<void>): Promise<void> => {
      const ticket = gate.begin()
      await wait
      if (ticket.current()) shown = name
    }
    const slow = deferred<void>()
    const fast = deferred<void>()
    const a = load('A', slow.promise)
    const b = load('B', fast.promise)
    fast.resolve()
    await b
    slow.resolve()
    await a
    expect(shown).toBe('B')
  })
})

describe('KeyedGate', () => {
  it('invalidates only loads for the same key', () => {
    const gate = new KeyedGate<string>()
    const a1 = gate.begin('a')
    const b1 = gate.begin('b')
    const a2 = gate.begin('a')
    expect(a1.current()).toBe(false)
    expect(a2.current()).toBe(true)
    expect(b1.current()).toBe(true)
  })
  it('cancel drops the key and its tickets', () => {
    const gate = new KeyedGate<string>()
    const ticket = gate.begin('a')
    gate.cancel('a')
    expect(ticket.current()).toBe(false)
    expect(gate.begin('a').current()).toBe(true)
  })
})

describe('InFlight', () => {
  it('shares one load between callers for the same key', async () => {
    const flight = new InFlight<string>()
    let calls = 0
    const gate = deferred<void>()
    const load = (): Promise<void> => { calls += 1; return gate.promise }
    const first = flight.run('k', load)
    const second = flight.run('k', load)
    expect(second).toBe(first)
    expect(flight.has('k')).toBe(true)
    gate.resolve()
    await first
    expect(calls).toBe(1)
    expect(flight.has('k')).toBe(false)
  })
  it('runs again after a finished or failed load', async () => {
    const flight = new InFlight<string>()
    let calls = 0
    await flight.run('k', async () => { calls += 1 })
    await expect(flight.run('k', async () => { calls += 1; throw new Error('x') })).rejects.toThrow('x')
    await flight.run('k', async () => { calls += 1 })
    expect(calls).toBe(3)
  })
})
