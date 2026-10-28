import { describe, expect, it } from 'vitest'
import { waitForSessionOutput, waitUntil } from '../../src/renderer/files/sessionWait'

function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

describe('waitUntil', () => {
  it('returns as soon as the check passes', async () => {
    const c = clock()
    expect(await waitUntil(() => c.now() >= 400, { timeoutMs: 5000, stepMs: 200, sleep: c.sleep })).toBe(true)
    expect(c.now()).toBe(400)
  })
  it('gives up at the timeout', async () => {
    const c = clock()
    expect(await waitUntil(() => false, { timeoutMs: 1000, stepMs: 200, sleep: c.sleep })).toBe(false)
    expect(c.now()).toBeGreaterThanOrEqual(1000)
  })
})

describe('waitForSessionOutput', () => {
  it('waits for the first output and then for quiet', async () => {
    const c = clock()
    const out = (): number | undefined => (c.now() >= 1000 ? Math.min(c.now(), 1600) : undefined)
    expect(await waitForSessionOutput(out, c.now, { timeoutMs: 15000, stepMs: 200, sleep: c.sleep }, 600, 3000)).toBe(true)
    expect(c.now()).toBeGreaterThanOrEqual(2200)
  })
  it('falls back when nothing is ever printed', async () => {
    const c = clock()
    expect(await waitForSessionOutput(() => undefined, c.now, { timeoutMs: 2000, stepMs: 200, sleep: c.sleep }, 600, 3000)).toBe(false)
  })
})
