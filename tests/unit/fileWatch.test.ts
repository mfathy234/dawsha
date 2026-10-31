import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createWatchRegistry, watchProject } from '../../src/main/fileWatch'

describe('watch registry', () => {
  it('keeps one watcher per folder and closes it with the last unwatch', () => {
    const stops: Array<ReturnType<typeof vi.fn>> = []
    const start = vi.fn(() => {
      const stop = vi.fn()
      stops.push(stop)
      return stop
    })
    const registry = createWatchRegistry(() => undefined, start)
    registry.watch('/p')
    registry.watch('/p')
    expect(start).toHaveBeenCalledTimes(1)
    registry.unwatch('/p')
    expect(stops[0]).not.toHaveBeenCalled()
    registry.unwatch('/p')
    expect(stops[0]).toHaveBeenCalledTimes(1)
    registry.unwatch('/p')
    registry.watch('/p')
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('keys folders by their normalized form and reports that key', () => {
    const emit = vi.fn()
    let report: (paths: string[]) => void = () => undefined
    const start = vi.fn((_folder: string, onChange: (paths: string[]) => void) => {
      report = onChange
      return vi.fn()
    })
    const registry = createWatchRegistry(emit, start as never)
    registry.watch('C:\\Work\\App\\')
    registry.watch('c:/work/app')
    expect(start).toHaveBeenCalledTimes(1)
    report(['a.ts'])
    expect(emit).toHaveBeenCalledWith('c:/work/app', ['a.ts'])
  })

  it('drops a watcher that errors and logs it', () => {
    const log = vi.fn()
    const stop = vi.fn()
    let fail: (error: Error) => void = () => undefined
    const start = vi.fn((_f: string, _c: unknown, _d: unknown, onError: (error: Error) => void) => {
      fail = onError
      return stop
    })
    const registry = createWatchRegistry(() => undefined, start as never, log)
    registry.watch('/p')
    fail(new Error('boom'))
    expect(stop).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'))
    registry.watch('/p')
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('closeAll stops every watcher', () => {
    const stop = vi.fn()
    const registry = createWatchRegistry(() => undefined, () => stop)
    registry.watch('/a')
    registry.watch('/b')
    registry.closeAll()
    expect(stop).toHaveBeenCalledTimes(2)
  })
})

describe('watchProject', () => {
  it('reports [] when more paths than the cap change in one batch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawsha-watch-many-'))
    const batches: string[][] = []
    const stop = watchProject(dir, (paths) => batches.push(paths), 300, undefined, 5)
    try {
      // FSEvents (macOS) can drop or split events written in the first moments after the stream starts.
      if (process.platform === 'darwin') await new Promise((r) => setTimeout(r, 500))
      for (let i = 0; i < 20; i += 1) writeFileSync(join(dir, `f${i}.txt`), '1')
      await vi.waitFor(() => expect(batches.some((b) => b.length === 0)).toBe(true), { timeout: 8000 })
    } finally {
      stop()
    }
  })

  it('reports one debounced batch and ignores .git and node_modules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawsha-watch-'))
    mkdirSync(join(dir, 'node_modules'))
    mkdirSync(join(dir, '.git'))
    const batches: string[][] = []
    const stop = watchProject(dir, (paths) => batches.push(paths), 50)
    try {
      // FSEvents (macOS) can drop events written in the first moments after the stream starts.
      if (process.platform === 'darwin') await new Promise((r) => setTimeout(r, 500))
      writeFileSync(join(dir, 'node_modules', 'x.js'), '1')
      writeFileSync(join(dir, '.git', 'HEAD'), '1')
      writeFileSync(join(dir, 'a.txt'), '1')
      writeFileSync(join(dir, 'b.txt'), '1')
      // macOS FSEvents may split the writes over two debounced batches, so wait until both files have been reported.
      await vi.waitFor(() => expect(batches.flat()).toEqual(expect.arrayContaining(['a.txt', 'b.txt'])), { timeout: 3000 })
      const seen = batches.flat()
      expect(seen.some((p) => p.startsWith('node_modules') || p.startsWith('.git'))).toBe(false)
    } finally {
      stop()
    }
    const count = batches.length
    writeFileSync(join(dir, 'c.txt'), '1')
    await new Promise((r) => setTimeout(r, 200))
    expect(batches.length).toBe(count)
  })
})
