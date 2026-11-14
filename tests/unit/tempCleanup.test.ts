import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTempCreatedSince } from '../support/tempCleanup'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('removeTempCreatedSince', () => {
  it('removes only dawsha folders it owns that appeared after the run began', () => {
    const root = mkdtempSync(join(tmpdir(), 'cleanup-check-'))
    roots.push(root)
    const before = join(root, 'dawsha-e2e-old')
    mkdirSync(before)
    const startedAt = Date.now() + 50
    const wait = Date.now() + 80
    while (Date.now() < wait) { /* let the clock pass the run start */ }
    for (const name of ['dawsha-e2e-new', 'dawsha-agents-new', 'other-new']) mkdirSync(join(root, name))
    const removed = removeTempCreatedSince(startedAt, (name) => name.startsWith('dawsha-e2e-'), root)
    expect(removed).toBe(1)
    expect(existsSync(join(root, 'dawsha-e2e-new'))).toBe(false)
    expect(existsSync(before)).toBe(true)
    expect(existsSync(join(root, 'dawsha-agents-new'))).toBe(true)
    expect(existsSync(join(root, 'other-new'))).toBe(true)
    utimesSync(before, new Date(), new Date())
  })

  it('keeps everything when DAWSHA_KEEP_TEMP is set', () => {
    const root = mkdtempSync(join(tmpdir(), 'cleanup-check-'))
    roots.push(root)
    process.env.DAWSHA_KEEP_TEMP = '1'
    try {
      mkdirSync(join(root, 'dawsha-x'))
      expect(removeTempCreatedSince(0, () => true, root)).toBe(0)
      expect(existsSync(join(root, 'dawsha-x'))).toBe(true)
    } finally {
      delete process.env.DAWSHA_KEEP_TEMP
    }
  })
})
