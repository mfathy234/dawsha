import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ignoredBlockers, removeWorktreeSafely, scanLinks } from '../../src/main/worktreeSafeRemove'

const roots: string[] = []
const IDENTITY = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' }
const saved = { ...process.env }

beforeAll(() => Object.assign(process.env, IDENTITY))
afterAll(() => {
  process.env = saved
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim()
const linkType = process.platform === 'win32' ? 'junction' : 'dir'

interface Fixture {
  repo: string
  tree: string
  target: string
  head: string
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-safe-'))
  roots.push(root)
  const repo = join(root, 'acme')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\nbuild\ndata\n')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const tree = join(root, 'acme-wt')
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', tree, 'HEAD')
  const target = join(root, 'shared-modules')
  mkdirSync(join(target, 'pkg'), { recursive: true })
  writeFileSync(join(target, 'pkg', 'index.js'), 'keep me\n')
  symlinkSync(target, join(tree, 'node_modules'), linkType)
  return { repo, tree, target, head: git(tree, 'rev-parse', 'HEAD') }
}

const request = (f: Fixture, over: Partial<{ strict: boolean; dryRun: boolean; headSha: string }> = {}) => ({ repo: f.repo, path: f.tree, branch: 'feature/x', headSha: over.headSha ?? f.head, strict: over.strict ?? true, dryRun: over.dryRun ?? false })

describe('removeWorktreeSafely', () => {
  it('removes the worktree without touching what a junction points at', async () => {
    const f = fixture()
    expect((await scanLinks(f.tree)).links).toEqual([join(f.tree, 'node_modules')])
    const result = await removeWorktreeSafely(request(f))
    expect(result).toEqual({ ok: true })
    expect(existsSync(f.tree)).toBe(false)
    expect(readFileSync(join(f.target, 'pkg', 'index.js'), 'utf8')).toBe('keep me\n')
    expect(git(f.repo, 'worktree', 'list', '--porcelain')).not.toContain('acme-wt')
  })

  it('unlinks a link nested deeper in the tree too', async () => {
    const f = fixture()
    mkdirSync(join(f.tree, 'build', 'er'), { recursive: true })
    symlinkSync(f.target, join(f.tree, 'build', 'er', 'linked'), linkType)
    expect((await scanLinks(f.tree)).links).toHaveLength(2)
    expect(await removeWorktreeSafely(request(f))).toEqual({ ok: true })
    expect(existsSync(join(f.target, 'pkg', 'index.js'))).toBe(true)
  })

  it('refuses a worktree with uncommitted changes and leaves its link alone', async () => {
    const f = fixture()
    writeFileSync(join(f.tree, 'a.txt'), 'changed\n')
    const result = await removeWorktreeSafely(request(f))
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.error).toContain('uncommitted')
    expect(existsSync(join(f.tree, 'node_modules', 'pkg', 'index.js'))).toBe(true)
  })

  it('refuses commits that are on no remote, but accepts ones the pull request already has', async () => {
    const f = fixture()
    writeFileSync(join(f.tree, 'b.txt'), 'two\n')
    git(f.tree, 'add', '.')
    git(f.tree, 'commit', '-q', '-m', 'second')
    const refused = await removeWorktreeSafely(request(f, { headSha: f.head }))
    expect(refused).toMatchObject({ ok: false })
    expect(!refused.ok && refused.error).toContain('not on any remote')
    expect(existsSync(f.tree)).toBe(true)
    const onPr = await removeWorktreeSafely(request(f, { headSha: git(f.tree, 'rev-parse', 'HEAD') }))
    expect(onPr).toEqual({ ok: true })
  })

  it('checks without removing on a dry run, and never touches the main checkout', async () => {
    const f = fixture()
    expect(await removeWorktreeSafely(request(f, { dryRun: true }))).toEqual({ ok: true })
    expect(existsSync(join(f.tree, 'node_modules'))).toBe(true)
    const main = await removeWorktreeSafely({ ...request(f), path: f.repo })
    expect(main).toMatchObject({ ok: false })
    expect(existsSync(join(f.repo, 'a.txt'))).toBe(true)
  })

  it('keeps a worktree that holds ignored data, but not one with only build folders or .worktreeinclude copies', async () => {
    const f = fixture()
    mkdirSync(join(f.tree, 'data'))
    writeFileSync(join(f.tree, 'data', 'local.db'), 'precious')
    const refused = await removeWorktreeSafely(request(f, { dryRun: true }))
    expect(refused).toMatchObject({ ok: false })
    expect(!refused.ok && refused.error).toContain('data/local.db')
    writeFileSync(join(f.repo, '.worktreeinclude'), 'data/*.db')
    expect(await removeWorktreeSafely(request(f, { dryRun: true }))).toEqual({ ok: true })
    mkdirSync(join(f.tree, 'build'))
    writeFileSync(join(f.tree, 'build', 'out.js'), 'x')
    expect(await removeWorktreeSafely(request(f, { dryRun: true }))).toEqual({ ok: true })
  })

  it('filters ignored paths', () => {
    const paths = ['node_modules/', 'a/dist/x.js', '.env', 'data/local.db', 'src/.venv/lib/y.py', 'notes/todo.txt']
    expect(ignoredBlockers(paths, [])).toEqual(['.env', 'data/local.db', 'notes/todo.txt'])
    expect(ignoredBlockers(paths, ['.env', 'data/*.db'])).toEqual(['notes/todo.txt'])
  })
})
