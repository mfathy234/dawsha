import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedTitleInfo, clearTitleCache } from '../../src/main/sessionsWatcher'

const line = (text: string): string => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n'

describe('cachedTitleInfo', () => {
  beforeEach(() => clearTitleCache())

  it('reads once while size and mtime are unchanged', async () => {
    const read = vi.fn(async () => ({ head: line('Fix the login bug'), tail: '' }))
    const stats = vi.fn(async () => ({ size: 100, mtimeMs: 5 }))
    const first = await cachedTitleInfo('/a.jsonl', false, read, stats)
    const second = await cachedTitleInfo('/a.jsonl', false, read, stats)
    expect(second).toBe(first)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads again when the file changed', async () => {
    const read = vi.fn(async () => ({ head: line('Fix the login bug'), tail: '' }))
    let size = 100
    const stats = async () => ({ size, mtimeMs: size })
    await cachedTitleInfo('/a.jsonl', false, read, stats)
    size = 200
    await cachedTitleInfo('/a.jsonl', false, read, stats)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('does not even stat a named session once its first prompt is cached', async () => {
    const read = vi.fn(async () => ({ head: line('Fix the login bug'), tail: '' }))
    const stats = vi.fn(async () => ({ size: 100, mtimeMs: 5 }))
    const first = await cachedTitleInfo('/a.jsonl', true, read, stats)
    expect(first.firstPrompt).toContain('Fix the login bug')
    stats.mockImplementation(async () => ({ size: 900, mtimeMs: 9 }))
    await cachedTitleInfo('/a.jsonl', true, read, stats)
    expect(read).toHaveBeenCalledTimes(1)
    expect(stats).toHaveBeenCalledTimes(1)
  })
})
