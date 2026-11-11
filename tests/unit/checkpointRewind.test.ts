import { execFileSync } from 'node:child_process'
import { existsSync, utimesSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCheckpointToWorktree, parseTreeDiff, rewindInfo } from '../../src/main/checkpointRewind'
import { prepareCheckpoint, storeCheckpoint } from '../../src/main/checkpoints'
import { parseHandoffRequest } from '../../src/shared/handoff'

const S = 'session-rewind'
let root: string
let extra: string | null = null
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

async function checkpoint(messageId: string): Promise<string> {
  expect(await prepareCheckpoint(root, S)).toBe(true)
  const ref = await storeCheckpoint(root, S, messageId, 0)
  expect(ref).not.toBeNull()
  return ref as string
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dawsha-rewind-test-'))
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'core.autocrlf', 'false')
  await writeFile(join(root, 'change.txt'), 'before\n')
  await writeFile(join(root, 'gone.txt'), 'keep\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  if (extra) await rm(extra, { recursive: true, force: true })
  extra = null
})

describe('rewindInfo', () => {
  it('marks files the snapshot lacks as new and files written after the reply as changed since', async () => {
    const ref = await checkpoint('m1')
    await writeFile(join(root, 'change.txt'), 'agent\n')
    await writeFile(join(root, 'fresh.txt'), 'new\n')
    const old = new Date(Date.now() - 600_000)
    utimesSync(join(root, 'change.txt'), old, old)
    const result = await rewindInfo(root, S, ref, [{ path: 'change.txt', touchedAt: Date.now() - 300_000 }, { path: 'fresh.txt', touchedAt: Date.now() - 60_000 }])
    expect(result).toEqual({ ok: true, files: [{ path: 'change.txt', isNew: false, changedSince: false }, { path: 'fresh.txt', isNew: true, changedSince: true }] })
  })

  it('refuses a bad checkpoint, escaping paths and an empty list', async () => {
    const ref = await checkpoint('m1')
    expect((await rewindInfo(root, S, 'refs/heads/main', [{ path: 'a' }])).ok).toBe(false)
    expect((await rewindInfo(root, S, ref, [{ path: '../x' }])).ok).toBe(false)
    expect((await rewindInfo(root, S, ref, [])).ok).toBe(false)
  })
})

describe('applyCheckpointToWorktree', () => {
  it('makes a new worktree match the snapshot, including uncommitted edits, new files and deletions', async () => {
    await writeFile(join(root, 'change.txt'), 'uncommitted\n')
    await rm(join(root, 'gone.txt'))
    await writeFile(join(root, 'added.txt'), 'added\n')
    const ref = await checkpoint('m1')
    extra = `${root}-try`
    git('worktree', 'add', '-b', 'try/one', extra, 'HEAD')
    const result = await applyCheckpointToWorktree(root, S, ref, extra)
    expect(result).toEqual({ ok: true, files: 3 })
    expect(await readFile(join(extra, 'change.txt'), 'utf8')).toBe('uncommitted\n')
    expect(await readFile(join(extra, 'added.txt'), 'utf8')).toBe('added\n')
    expect(existsSync(join(extra, 'gone.txt'))).toBe(false)
  })

  it('refuses a folder that is not a worktree of the project', async () => {
    const ref = await checkpoint('m1')
    const other = await mkdtemp(join(tmpdir(), 'dawsha-not-worktree-'))
    try {
      expect((await applyCheckpointToWorktree(root, S, ref, other)).ok).toBe(false)
      expect((await applyCheckpointToWorktree(root, S, ref, root)).ok).toBe(false)
      expect((await applyCheckpointToWorktree(root, S, ref, 42)).ok).toBe(false)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})

describe('parsing', () => {
  it('splits a tree diff into writes and deletes', () => {
    expect(parseTreeDiff('M\0a.txt\0D\0b.txt\0A\0c/d.txt\0')).toEqual({ write: ['a.txt', 'c/d.txt'], remove: ['b.txt'] })
  })

  it('accepts an optional cut on a handoff request and rejects a bad one', () => {
    const base = { projectId: 'p', agent: 'claude', sessionId: 's1' }
    expect(parseHandoffRequest(base)).toEqual(base)
    expect(parseHandoffRequest({ ...base, cut: { text: 'hi', laterSame: 1 } })).toEqual({ ...base, cut: { text: 'hi', laterSame: 1 } })
    expect(parseHandoffRequest({ ...base, cut: { text: '', laterSame: 0 } })).toBeNull()
    expect(parseHandoffRequest({ ...base, cut: { text: 'x', laterSame: -1 } })).toBeNull()
  })
})
