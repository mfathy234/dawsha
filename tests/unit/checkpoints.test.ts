import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkpointRef, undoRef, validCheckpointRef, validUndoRef, refsToPrune } from '../../src/shared/checkpoints'
import { turnSummaries } from '../../src/shared/turnSummary'
import type { ChatItem } from '../../src/shared/chatLog'
import { normalizeRestorePaths } from '../../src/main/checkpointPaths'
import { checkpointKey, listCheckpoints, prepareCheckpoint, restoreCheckpoint, storeCheckpoint } from '../../src/main/checkpoints'

const S = 'session-test'
let root: string
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const read = (path: string): Promise<string> => readFile(join(root, path), 'utf8')
const exists = (path: string): Promise<boolean> => readFile(join(root, path)).then(() => true, () => false)

async function checkpointFor(messageId: string): Promise<string> {
  expect(await prepareCheckpoint(root, S)).toBe(true)
  const ref = await storeCheckpoint(root, S, messageId, 0)
  expect(ref).not.toBeNull()
  return ref as string
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dawsha-checkpoint-test-'))
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'core.autocrlf', 'false')
  await writeFile(join(root, 'change.txt'), 'before\n')
  await writeFile(join(root, 'delete.txt'), 'keep\n')
  await writeFile(join(root, 'other.txt'), 'other\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('checkpoint references', () => {
  it('builds private refs from a safe key and keeps undo snapshots in their own namespace', () => {
    const key = checkpointKey('msg-1')
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(checkpointKey('msg-1')).toBe(key)
    expect(checkpointRef('s-1', key)).toBe(`refs/dawsha/checkpoints/s-1/${key}`)
    expect(checkpointRef('../oops', key)).toBeNull()
    expect(checkpointRef('s-1', '../x')).toBeNull()
    expect(validCheckpointRef('s-1', `refs/dawsha/checkpoints/s-1/${key}`)).toBe(true)
    expect(validCheckpointRef('s-1', 'refs/heads/main')).toBe(false)
    expect(validCheckpointRef('s-1', 'refs/dawsha/undo/s-1/1')).toBe(false)
    expect(undoRef('s-1', 3)).toBe('refs/dawsha/undo/s-1/3')
    expect(validUndoRef('s-1', 'refs/dawsha/undo/s-1/3')).toBe(true)
    expect(validUndoRef('s-1', 'refs/dawsha/undo/other/3')).toBe(false)
  })

  it('prunes only the oldest refs beyond the limit', () => {
    expect(refsToPrune(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b'])
    expect(refsToPrune(['a'], 2)).toEqual([])
  })
})

describe('restore paths', () => {
  it('accepts clean relative paths and absolute paths inside the root, rejects everything else', () => {
    expect(normalizeRestorePaths(root, ['src/a.ts', join(root, 'b.ts')])).toEqual({ ok: true, paths: ['src/a.ts', 'b.ts'] })
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\x', '.git/config', '', '.', join(root, '..', 'x')]) {
      expect(normalizeRestorePaths(root, [bad]).ok, bad).toBe(false)
    }
    expect(normalizeRestorePaths(root, []).ok).toBe(false)
    expect(normalizeRestorePaths(root, 'x').ok).toBe(false)
  })
})

describe('restoring a reply', () => {
  it('restores only the turn files; unrelated edits and new files survive; HEAD, branch and index are untouched', async () => {
    const head = git('rev-parse', 'HEAD')
    const branch = git('branch', '--show-current')
    const ref = await checkpointFor('u1')
    await writeFile(join(root, 'change.txt'), 'after\n')
    await rm(join(root, 'delete.txt'))
    await mkdir(join(root, 'new'))
    await writeFile(join(root, 'new', 'file.txt'), 'created\n')
    await writeFile(join(root, 'other.txt'), 'user edit\n')
    await writeFile(join(root, 'untracked.txt'), 'mine\n')
    git('add', 'change.txt')
    const index = git('diff', '--cached', '--name-only')
    const result = await restoreCheckpoint(root, S, ref, ['change.txt', 'delete.txt', 'new/file.txt'])
    expect(result.ok).toBe(true)
    expect(await read('change.txt')).toBe('before\n')
    expect(await read('delete.txt')).toBe('keep\n')
    expect(await exists('new/file.txt')).toBe(false)
    expect(await read('other.txt')).toBe('user edit\n')
    expect(await read('untracked.txt')).toBe('mine\n')
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(git('branch', '--show-current')).toBe(branch)
    expect(git('diff', '--cached', '--name-only')).toBe(index)
  })

  it('refuses bad paths and foreign refs without touching files', async () => {
    const ref = await checkpointFor('u1')
    await writeFile(join(root, 'change.txt'), 'after\n')
    expect((await restoreCheckpoint(root, S, ref, ['../x'])).ok).toBe(false)
    expect((await restoreCheckpoint(root, S, 'refs/heads/master', ['change.txt'])).ok).toBe(false)
    expect(await read('change.txt')).toBe('after\n')
  })

  it('never deletes an ignored file the checkpoint could not hold', async () => {
    await writeFile(join(root, '.gitignore'), 'secret.env\n')
    git('add', '.gitignore')
    git('commit', '-qm', 'ignore')
    const ref = await checkpointFor('u1')
    await writeFile(join(root, 'secret.env'), 'KEY=1\n')
    const result = await restoreCheckpoint(root, S, ref, ['secret.env'])
    expect(result.ok).toBe(true)
    expect(await read('secret.env')).toBe('KEY=1\n')
  })

  it('redo restores the post-reply content of just those files', async () => {
    const ref = await checkpointFor('u1')
    await writeFile(join(root, 'change.txt'), 'after\n')
    await writeFile(join(root, 'new.txt'), 'created\n')
    await writeFile(join(root, 'other.txt'), 'user edit\n')
    const paths = ['change.txt', 'new.txt']
    const undone = await restoreCheckpoint(root, S, ref, paths)
    if (!undone.ok) throw new Error(undone.error)
    expect(undone.beforeUndo).toMatch(/^refs\/dawsha\/undo\//)
    expect(await read('change.txt')).toBe('before\n')
    expect(await exists('new.txt')).toBe(false)
    await writeFile(join(root, 'other.txt'), 'edited again\n')
    const redone = await restoreCheckpoint(root, S, undone.beforeUndo as string, paths)
    expect(redone.ok).toBe(true)
    expect(await read('change.txt')).toBe('after\n')
    expect(await read('new.txt')).toBe('created\n')
    expect(await read('other.txt')).toBe('edited again\n')
  })
})

describe('checkpoints keyed by user message', () => {
  const user = (id: string): ChatItem => ({ kind: 'message', id, role: 'user', text: 'go' })
  const agent = (id: string): ChatItem => ({ kind: 'message', id, role: 'agent', text: 'done' })
  const edit = (id: string, path: string): ChatItem => ({ kind: 'tool', id, activity: 'edit', verb: 'Edited', target: path, path, added: 1, removed: 0, output: '', outputTruncated: false, done: true })

  it('gives each summary its own checkpoint even when a turn has no edits and an undo happened in between', async () => {
    const r1 = await checkpointFor('u1')
    await writeFile(join(root, 'change.txt'), 'turn1\n')
    const r2 = await checkpointFor('u2')
    const undone = await restoreCheckpoint(root, S, r1, ['change.txt'])
    expect(undone.ok).toBe(true)
    await writeFile(join(root, 'change.txt'), 'turn3-start\n')
    const r3 = await checkpointFor('u3')
    await writeFile(join(root, 'change.txt'), 'turn3\n')
    const found = await listCheckpoints(root, S, ['u1', 'u2', 'u3', 'unknown'])
    expect(found).toEqual({ u1: r1, u2: r2, u3: r3 })
    const items = [user('u1'), edit('e1', 'change.txt'), agent('a1'), user('u2'), agent('a2'), user('u3'), edit('e3', 'change.txt'), agent('a3')]
    const summaries = turnSummaries(items, found)
    expect(summaries.map((s) => [s.messageId, s.checkpointRef])).toEqual([['a1', r1], ['a3', r3]])
    expect(git('show', `${r3}:change.txt`)).toBe('turn3-start')
    expect(git('show', `${r1}:change.txt`)).toBe('before')
  })

  it('stores nothing without a fresh pending snapshot (typed in the terminal, so the checkpoint would be late)', async () => {
    expect(await storeCheckpoint(root, S, 'u1', 0)).toBeNull()
    await prepareCheckpoint(root, S)
    expect(await storeCheckpoint(root, S, 'u1', Date.now() + 10_000)).toBeNull()
    expect(await storeCheckpoint(root, S, 'u1', 0)).toBeNull()
  })
})
