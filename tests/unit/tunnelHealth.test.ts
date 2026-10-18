import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTunnelHealthMonitor } from '../../src/main/tunnelHealth'

function fixture(results: boolean[]) {
  const queue = [...results]
  const probe = vi.fn(async () => (queue.length ? queue.shift()! : true))
  const onUnhealthy = vi.fn()
  const monitor = createTunnelHealthMonitor({ probe, onUnhealthy, intervalMs: 60_000 })
  return { probe, onUnhealthy, monitor }
}

describe('tunnel health monitor', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('probes every 60 seconds and stays quiet while healthy', async () => {
    const { probe, onUnhealthy, monitor } = fixture([])
    monitor.start()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(probe).toHaveBeenCalledTimes(3)
    expect(onUnhealthy).not.toHaveBeenCalled()
    monitor.stop()
  })

  it('tolerates one failure and resets on the next healthy probe', async () => {
    const { onUnhealthy, monitor } = fixture([false, true, false, true])
    monitor.start()
    await vi.advanceTimersByTimeAsync(240_000)
    expect(onUnhealthy).not.toHaveBeenCalled()
    monitor.stop()
  })

  it('reports unhealthy after two failures in a row', async () => {
    const { onUnhealthy, monitor } = fixture([false, false])
    monitor.start()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(onUnhealthy).toHaveBeenCalledTimes(1)
    expect(onUnhealthy).toHaveBeenCalledWith('failures')
    monitor.stop()
  })

  it('reports unhealthy after a single failure following resume', async () => {
    const { onUnhealthy, monitor } = fixture([false])
    monitor.start()
    expect(await monitor.check(true)).toBe(false)
    expect(onUnhealthy).toHaveBeenCalledWith('resume')
    monitor.stop()
  })

  it('treats a throwing probe as a failure and coalesces overlapping checks', async () => {
    let calls = 0
    const onUnhealthy = vi.fn()
    const monitor = createTunnelHealthMonitor({ probe: async () => { calls += 1; throw new Error('dns') }, onUnhealthy })
    monitor.start()
    const [a, b] = await Promise.all([monitor.check(true), monitor.check(true)])
    expect([a, b, calls]).toEqual([false, false, 1])
    expect(onUnhealthy).toHaveBeenCalledTimes(1)
    monitor.stop()
  })

  it('does nothing once stopped', async () => {
    const { probe, onUnhealthy, monitor } = fixture([false, false])
    monitor.start()
    monitor.stop()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await monitor.check(true)).toBe(true)
    expect(probe).not.toHaveBeenCalled()
    expect(onUnhealthy).not.toHaveBeenCalled()
  })
})
