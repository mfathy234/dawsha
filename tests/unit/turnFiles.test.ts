import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkpointRef } from '../../src/shared/checkpoints'
import { parseTurnDiff } from '../../src/shared/turnDiff'
import { inspectFiles, turnFileDiff } from '../../src/main/turnFiles'

const SESSION = 'sess-1'
let root = ''
let ref = ''

const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dawsha-turn-test-')))
  git('init', '-q')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'one\ntwo\nthree\n')
  writeFileSync(join(root, 'gone.ts'), 'bye\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  const made = checkpointRef(SESSION, '0123456789abcdef')!
  git('update-ref', made, 'HEAD')
  ref = made
  writeFileSync(join(root, 'src', 'a.ts'), 'one\n2\nthree\nfour\n')
  writeFileSync(join(root, 'fresh.ts'), 'new file\n')
  rmSync(join(root, 'gone.ts'))
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('turnFileDiff', () => {
  it('compares the checkpoint with the file now', async () => {
    const result = await turnFileDiff(root, SESSION, ref, 'src/a.ts')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const diff = parseTurnDiff(result.text)
    expect(diff.rows.filter((row) => row.k === 'del').map((row) => row.t)).toEqual(['two'])
    expect(diff.rows.filter((row) => row.k === 'add').map((row) => row.t)).toEqual(['2', 'four'])
    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it('shows a file the reply created as all added, and one it deleted as all removed', async () => {
    const created = await turnFileDiff(root, SESSION, ref, 'fresh.ts')
    const removed = await turnFileDiff(root, SESSION, ref, 'gone.ts')
    expect(created.ok && parseTurnDiff(created.text).added).toBe(1)
    expect(removed.ok && removed.gone).toBe(true)
    expect(removed.ok && parseTurnDiff(removed.text).removed).toBe(1)
  })

  it('accepts an absolute path inside the repository', async () => {
    const result = await turnFileDiff(root, SESSION, ref, join(root, 'src', 'a.ts'))
    expect(result.ok).toBe(true)
  })

  it('refuses a bad checkpoint, a path outside the repository and a missing snapshot', async () => {
    expect(await turnFileDiff(root, SESSION, 'refs/heads/main', 'src/a.ts')).toMatchObject({ ok: false })
    expect(await turnFileDiff(root, SESSION, ref, '../outside.txt')).toMatchObject({ ok: false })
    expect(await turnFileDiff(root, SESSION, checkpointRef(SESSION, 'ffffffffffffffff')!, 'src/a.ts')).toMatchObject({ ok: false, error: 'Checkpoint no longer exists.' })
    expect(await turnFileDiff(root, 'bad session!', ref, 'src/a.ts')).toMatchObject({ ok: false })
  })
})

describe('inspectFiles', () => {
  it('gives repository paths and save times, and leaves out paths outside the repository', async () => {
    const found = await inspectFiles(root, [join(root, 'src', 'a.ts'), 'gone.ts', '../x', 7])
    expect(found[join(root, 'src', 'a.ts')]).toMatchObject({ rel: 'src/a.ts' })
    expect(found[join(root, 'src', 'a.ts')].mtimeMs).toBeGreaterThan(0)
    expect(found['gone.ts']).toEqual({ rel: 'gone.ts', mtimeMs: null })
    expect(Object.keys(found)).toHaveLength(2)
  })

  it('returns nothing for a folder that is not a repository', async () => {
    expect(await inspectFiles(tmpdir(), ['a'])).toEqual({})
  })
})
