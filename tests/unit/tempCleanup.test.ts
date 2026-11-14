import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removePrivateTemp, removeTree, startPrivateTemp } from '../support/tempCleanup'

const roots: string[] = []
const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('private temp folder per test run', () => {
  it('points TEMP, TMP and TMPDIR at a new folder and removes only that folder', () => {
    const base = mkdtempSync(join(tmpdir(), 'cleanup-check-'))
    roots.push(base)
    const neighbour = join(base, 'dawsha-e2e-other-run')
    mkdirSync(neighbour)
    const dir = startPrivateTemp('unit', base)
    expect(process.env.TEMP).toBe(dir)
    expect(process.env.TMP).toBe(dir)
    expect(process.env.TMPDIR).toBe(dir)
    mkdirSync(join(dir, 'dawsha-e2e-mine', 'deep'), { recursive: true })
    removePrivateTemp(dir)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(neighbour)).toBe(true)
  })

  it('never deletes through a junction or symbolic link inside the folder', () => {
    const base = mkdtempSync(join(tmpdir(), 'cleanup-check-'))
    roots.push(base)
    const target = join(base, 'keep-me')
    mkdirSync(target)
    writeFileSync(join(target, 'important.txt'), 'still here')
    const run = join(base, 'run')
    mkdirSync(run)
    symlinkSync(target, join(run, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    removeTree(run)
    expect(existsSync(run)).toBe(false)
    expect(existsSync(join(target, 'important.txt'))).toBe(true)
  })

  it('keeps the folder when DAWSHA_KEEP_TEMP is set', () => {
    const base = mkdtempSync(join(tmpdir(), 'cleanup-check-'))
    roots.push(base)
    const dir = startPrivateTemp('unit', base)
    process.env.DAWSHA_KEEP_TEMP = '1'
    try {
      removePrivateTemp(dir)
      expect(existsSync(dir)).toBe(true)
    } finally {
      delete process.env.DAWSHA_KEEP_TEMP
    }
  })
})
