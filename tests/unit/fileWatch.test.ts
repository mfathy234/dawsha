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
  it('reports one debounced batch and ignores .git and node_modules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawsha-watch-'))
    mkdirSync(join(dir, 'node_modules'))
    mkdirSync(join(dir, '.git'))
    const batches: string[][] = []
    const stop = watchProject(dir, (paths) => batches.push(paths), 50)
    try {
      writeFileSync(join(dir, 'node_modules', 'x.js'), '1')
      writeFileSync(join(dir, '.git', 'HEAD'), '1')
      writeFileSync(join(dir, 'a.txt'), '1')
      writeFileSync(join(dir, 'b.txt'), '1')
      await vi.waitFor(() => expect(batches.length).toBeGreaterThan(0), { timeout: 3000 })
      const seen = batches.flat()
      expect(seen).toContain('a.txt')
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
