import { describe, expect, it } from 'vitest'
import { createKeyedQueue } from '../../src/renderer/keyedQueue'

const gate = () => {
  let open!: () => void
  const wait = new Promise<void>((resolve) => { open = resolve })
  return { wait, open }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('keyed queue', () => {
  it('runs the jobs for one key one after another', async () => {
    const queue = createKeyedQueue()
    const order: string[] = []
    const first = gate()
    const a = queue.run('g1', async () => { await first.wait; order.push('a') })
    const b = queue.run('g1', async () => { order.push('b') })
    await flush()
    expect(order).toEqual([])
    first.open()
    await Promise.all([a, b])
    expect(order).toEqual(['a', 'b'])
  })

  it('lets different keys run at the same time', async () => {
    const queue = createKeyedQueue()
    const held = gate()
    const slow = queue.run('g1', () => held.wait)
    let fast = false
    await queue.run('g2', async () => { fast = true })
    expect(fast).toBe(true)
    held.open()
    await slow
  })

  it('forgets a key once its queue has drained', async () => {
    const queue = createKeyedQueue()
    await queue.run('g1', async () => 'done')
    await flush()
    expect(queue.size()).toBe(0)
  })

  it('keeps a key while jobs are still queued behind it, and forgets it only after the last one', async () => {
    const queue = createKeyedQueue()
    const held = gate()
    const first = queue.run('g1', () => held.wait)
    const second = queue.run('g1', async () => 'second')
    held.open()
    await first
    expect(queue.size()).toBe(1)
    await second
    await flush()
    expect(queue.size()).toBe(0)
  })

  it('still runs the next job and forgets the key when a job fails', async () => {
    const queue = createKeyedQueue()
    await expect(queue.run('g1', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await queue.run('g1', async () => 'next')).toBe('next')
    await flush()
    expect(queue.size()).toBe(0)
  })
})
