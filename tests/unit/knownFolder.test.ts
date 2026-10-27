import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { knownProjectFolder } from '../../src/main/knownFolder'
import { normalizeFolder } from '../../src/shared/folderKey'

const IDENTITY = ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim()

function makeRepo(): string {
  const repo = join(mkdtempSync(join(tmpdir(), 'dawsha-known-')), 'app')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'x\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  return repo
}

describe('knownProjectFolder', () => {
  it('accepts a configured project, with a trailing slash and other casing on Windows', async () => {
    const repo = makeRepo()
    const projects = [{ folder: repo }]
    expect(await knownProjectFolder(projects, repo)).toBe(repo)
    expect(await knownProjectFolder(projects, `${repo}/`)).toBe(`${repo}/`)
    if (process.platform === 'win32') expect(await knownProjectFolder(projects, repo.toUpperCase())).not.toBeNull()
  })

  it('refuses folders that are not projects and bad input', async () => {
    const repo = makeRepo()
    const other = mkdtempSync(join(tmpdir(), 'dawsha-other-'))
    expect(await knownProjectFolder([{ folder: repo }], other)).toBeNull()
    expect(await knownProjectFolder([{ folder: repo }], join(repo, 'missing'))).toBeNull()
    expect(await knownProjectFolder([], repo)).toBeNull()
    expect(await knownProjectFolder([{ folder: repo }], 5)).toBeNull()
    expect(await knownProjectFolder([{ folder: repo }], '')).toBeNull()
  })

  it('accepts a linked git worktree of a project but not a separate repo', async () => {
    const repo = makeRepo()
    const wt = join(mkdtempSync(join(tmpdir(), 'dawsha-wt-')), 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'side', wt)
    expect(await knownProjectFolder([{ folder: repo }], wt)).toBe(wt)
    expect(await knownProjectFolder([{ folder: wt }], repo)).toBe(repo)
    expect(await knownProjectFolder([{ folder: repo }], makeRepo())).toBeNull()
  })
})

describe('normalizeFolder', () => {
  it('ignores slashes, trailing slash and Windows casing', () => {
    expect(normalizeFolder('C:\\Work\\App\\')).toBe(normalizeFolder('c:/work/app'))
    expect(normalizeFolder('/home/Me/App/')).toBe('/home/Me/App')
    expect(normalizeFolder('/home/Me/App')).not.toBe(normalizeFolder('/home/me/app'))
  })
})
