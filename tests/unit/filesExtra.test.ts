import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileLog, linkedRepos, readImage, searchFiles, walkSearch } from '../../src/main/filesExtra'
import type { SearchRequest } from '../../src/shared/fileSearch'

const request = (over: Partial<SearchRequest> = {}): SearchRequest => ({ query: 'needle', matchCase: false, wholeWord: false, regex: false, include: '', ...over })
const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' })
}

let root = ''
beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dawsha-search-')))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const put = (rel: string, text: string | Buffer): void => {
  const full = join(root, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

describe('walkSearch (folders that are not repositories)', () => {
  it('finds matches in line order and skips node_modules, build output, binaries and big files', async () => {
    put('src/a.ts', 'x\nNeedle here\n')
    put('node_modules/pkg/i.js', 'needle')
    put('dist/out.js', 'needle')
    put('.git/config', 'needle')
    put('bin.dat', Buffer.from([110, 101, 101, 100, 108, 101, 0, 1]))
    put('logo.png', 'needle')
    put('big.txt', `${'x'.repeat(1024 * 1024 + 10)}needle`)
    const result = await walkSearch(root, request())
    expect(result).toMatchObject({ ok: true, engine: 'walk', total: 1, truncated: false })
    if (result.ok) expect(result.files).toEqual([{ path: 'src/a.ts', matches: [{ line: 2, text: 'Needle here' }] }])
  })
  it('applies the include glob, case and whole word', async () => {
    put('a.ts', 'needle\nNeedles')
    put('b.md', 'needle')
    const ts = await walkSearch(root, request({ include: '*.ts', matchCase: true, wholeWord: true }))
    expect(ts.ok && ts.files).toEqual([{ path: 'a.ts', matches: [{ line: 1, text: 'needle' }] }])
  })
  it('refuses an invalid regular expression', async () => {
    expect((await walkSearch(root, request({ query: '(', regex: true }))).ok).toBe(false)
  })
})

describe('searchFiles in a repository', () => {
  it('uses git grep, includes untracked files, and leaves out ignored ones', async () => {
    git(root, 'init', '-q', '-b', 'main')
    put('.gitignore', 'ignored/\n')
    put('tracked.ts', 'one needle\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'first')
    put('fresh.ts', 'another needle\n')
    put('ignored/skip.ts', 'needle\n')
    const result = await searchFiles(root, request())
    expect(result.ok && result.engine).toBe('git')
    if (result.ok) expect(result.files.map((file) => file.path).sort()).toEqual(['fresh.ts', 'tracked.ts'])
  })
  it('reports no matches as an empty result, not an error', async () => {
    git(root, 'init', '-q', '-b', 'main')
    put('a.ts', 'nothing\n')
    git(root, 'add', '.')
    expect(await searchFiles(root, request())).toMatchObject({ ok: true, files: [], total: 0 })
  })
  it('scopes to the folder when the project is a subfolder', async () => {
    git(root, 'init', '-q', '-b', 'main')
    put('pkg/a.ts', 'needle\n')
    put('other/b.ts', 'needle\n')
    git(root, 'add', '.')
    const result = await searchFiles(join(root, 'pkg'), request())
    if (result.ok) expect(result.files.map((file) => file.path)).toEqual(['pkg/a.ts'])
    else throw new Error(result.error)
  })
  it('rejects a bad request before running anything', async () => {
    expect((await searchFiles(root, { query: '' })).ok).toBe(false)
    expect((await searchFiles(root, { query: 'x', include: '../x' })).ok).toBe(false)
  })
})

describe('fileLog and readImage', () => {
  it('lists the commits that touched a file', async () => {
    git(root, 'init', '-q', '-b', 'main')
    put('a.ts', '1\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'add a')
    put('a.ts', '2\n')
    git(root, 'commit', '-q', '-am', 'change a')
    const log = await fileLog(root, 'a.ts')
    expect(log.ok && log.commits.map((commit) => commit.subject)).toEqual(['change a', 'add a'])
  })
  it('refuses paths outside the project', async () => {
    expect((await fileLog(root, '../x')).ok).toBe(false)
    expect((await readImage(root, '../x.png', false)).ok).toBe(false)
  })
  it('reads an image as a data url and refuses other types', async () => {
    put('p.png', Buffer.from([137, 80, 78, 71]))
    const image = await readImage(root, 'p.png', false)
    expect(image.ok && image.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect((await readImage(root, 'a.ts', false)).ok).toBe(false)
  })
  it('reads the version on main for the compare view', async () => {
    git(root, 'init', '-q', '-b', 'main')
    put('p.png', Buffer.from([1, 2, 3]))
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'img')
    put('p.png', Buffer.from([9, 9, 9, 9]))
    const base = await readImage(root, 'p.png', true)
    expect(base.ok && base.size).toBe(3)
  })
})

describe('linkedRepos', () => {
  it('offers a repository only when a configured project accepts it, and never the current project itself', async () => {
    const mine = join(root, 'mine')
    const other = join(root, 'other')
    const stranger = join(root, 'stranger')
    for (const folder of [mine, other, stranger]) {
      mkdirSync(folder, { recursive: true })
      git(folder, 'init', '-q', '-b', 'main')
    }
    mkdirSync(join(other, 'src'))
    const projects = [{ id: 'mine', folder: mine }, { id: 'other', folder: other }]
    const found = await linkedRepos(projects, 'mine', [join(other, 'src'), stranger, mine, 'relative/path', 5])
    expect(found.map((repo) => [repo.name, repo.projectId])).toEqual([['other', 'other'], ['stranger', null]])
  })
  it('returns nothing for bad input', async () => {
    expect(await linkedRepos([], 'x', 'nope')).toEqual([])
  })
})
