import { describe, expect, it, vi } from 'vitest'
import { waitForTunnelHostname } from '../../src/main/tunnelReachability'

function clock() {
  let time = 0
  return { now: () => time, sleep: vi.fn(async (ms: number) => { time += ms }) }
}

describe('tunnel hostname reachability', () => {
  it('returns true at once when the hostname resolves', async () => {
    const { now, sleep } = clock()
    const resolve = vi.fn(async () => ['104.16.0.1'])
    await expect(waitForTunnelHostname('a.trycloudflare.com', { resolve, now, sleep, timeoutMs: 90_000 })).resolves.toBe(true)
    expect(resolve).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('keeps retrying with growing, capped backoff until the name appears', async () => {
    const { now, sleep } = clock()
    let calls = 0
    const resolve = vi.fn(async () => { if (++calls < 6) throw new Error('ENOTFOUND'); return [] })
    const attempts: number[] = []
    await expect(waitForTunnelHostname('a.trycloudflare.com', { resolve, now, sleep, timeoutMs: 90_000, onAttempt: (n) => attempts.push(n) })).resolves.toBe(true)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1500, 2250, 3375, 5000])
    expect(attempts).toEqual([1, 2, 3, 4, 5])
  })

  it('gives up after the timeout and never sleeps past it', async () => {
    const { now, sleep } = clock()
    const resolve = vi.fn(async () => { throw new Error('ENOTFOUND') })
    await expect(waitForTunnelHostname('a.trycloudflare.com', { resolve, now, sleep, timeoutMs: 20_000 })).resolves.toBe(false)
    expect(now()).toBe(20_000)
  })

  it('stops as soon as it is cancelled', async () => {
    const { now, sleep } = clock()
    let cancelled = false
    const resolve = vi.fn(async () => { cancelled = true; throw new Error('ENOTFOUND') })
    await expect(waitForTunnelHostname('a.trycloudflare.com', { resolve, now, sleep, timeoutMs: 90_000, isCancelled: () => cancelled })).resolves.toBe(false)
    expect(resolve).toHaveBeenCalledOnce()
  })
})
