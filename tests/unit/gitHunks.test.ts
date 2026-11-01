import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { changeHunk, diffHunks } from '../../src/main/gitHunks'
import type { HunkRequest } from '../../src/shared/codeNavExtras'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function git(root: string, args: string[]): string { return execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }) }
function fixture(eol = '\n', autocrlf = 'false'): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-hunk-'))
  roots.push(root)
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.name', 'Tests'])
  git(root, ['config', 'user.email', 'tests@example.test'])
  git(root, ['config', 'core.autocrlf', autocrlf])
  writeFileSync(join(root, 'a.txt'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join(eol) + eol)
  git(root, ['add', 'a.txt'])
  git(root, ['commit', '-qm', 'initial'])
  writeFileSync(join(root, 'a.txt'), readFileSync(join(root, 'a.txt'), 'utf8').replace(`line 2${eol}`, `changed 2${eol}`).replace(`line 25${eol}`, `changed 25${eol}`))
  return root
}
async function request(root: string): Promise<HunkRequest> {
  const diff = git(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', '--no-renames', 'HEAD', '--', 'a.txt'])
  const hunk = diffHunks(diff)[0]
  return { path: 'a.txt', ...hunk.coordinates, expectedMtime: statSync(join(root, 'a.txt')).mtimeMs, expectedHunk: hunk.text }
}
describe('one hunk', () => {
  for (const eol of ['\n', '\r\n']) {
    for (const autocrlf of ['true', 'false', 'input']) {
      it.each(['stage', 'revert'] as const)(`%s preserves ${eol === '\n' ? 'LF' : 'CRLF'} bytes with core.autocrlf=${autocrlf}`, async operation => {
        const root = fixture(eol, autocrlf)
        const workingBefore = readFileSync(join(root, 'a.txt'), 'utf8')
        const indexBefore = git(root, ['show', ':a.txt'])
        const selected = await request(root)
        expect(await changeHunk(root, selected, operation)).toEqual({ ok: true })
        expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe(operation === 'stage' ? workingBefore : workingBefore.replace(`changed 2${eol}`, `line 2${eol}`))
        expect(git(root, ['show', ':a.txt'])).toBe(operation === 'revert' ? indexBefore : indexBefore.replace('line 2', 'changed 2'))
      })
    }
  }
  it.each([
    ['a final line without a newline', 'first\nlast', 'first\nchanged'],
    ['a final carriage return without LF', 'first\nlast\r', 'first\nchanged\r'],
    ['an inserted line', 'first\nlast\n', 'first\ninserted\nlast\n'],
    ['a removed line', 'first\nremoved\nlast\n', 'first\nlast\n'],
    ['mixed line endings', 'first\r\nsecond\nlast\r\n', 'first\r\nchanged\nlast\r\n'],
    ['a literal LF changed to CRLF', 'first\nlast\n', 'first\r\nlast\n'],
    ['a removed LF line between CRLF lines', 'first\r\nremoved\nlast\r\n', 'first\r\nlast\r\n']
  ])('reverts %s without applying editor save rules', async (_name, before, after) => {
    const root = fixture()
    writeFileSync(join(root, 'a.txt'), before)
    git(root, ['add', 'a.txt'])
    git(root, ['commit', '-qm', 'line shape'])
    writeFileSync(join(root, '.editorconfig'), 'root = true\n[*]\nend_of_line = crlf\ninsert_final_newline = true\n')
    writeFileSync(join(root, 'a.txt'), after)
    expect(await changeHunk(root, await request(root), 'revert')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe(before)
    expect(git(root, ['show', ':a.txt'])).toBe(before)
  })
  it.each([
    ['-text', 'true', 'first\nlast\r\n', 'first\r\nlast\r\n'],
    ['text eol=lf', 'false', 'first\r\nlast\r\n', 'changed\r\nlast\r\n'],
    ['text eol=crlf', 'false', 'first\r\nlast\r\n', 'changed\r\nlast\r\n'],
    ['text=auto', 'true', 'first\nlast\r\n', 'first\r\nlast\r\n']
  ])('uses the actual diff conversion for attributes %s and core.autocrlf=%s', async (attributes, autocrlf, before, after) => {
    const root = fixture()
    // Commit literal bytes first: text=auto must preserve an existing CRLF index.
    writeFileSync(join(root, 'a.txt'), before)
    git(root, ['add', 'a.txt'])
    git(root, ['commit', '-qm', 'literal baseline'])
    git(root, ['config', 'core.autocrlf', autocrlf])
    writeFileSync(join(root, '.gitattributes'), `a.txt ${attributes}\n`)
    writeFileSync(join(root, 'a.txt'), after)
    const indexBefore = git(root, ['show', ':a.txt'])
    expect(await changeHunk(root, await request(root), 'revert')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe(before)
    expect(git(root, ['show', ':a.txt'])).toBe(indexBefore)
  })
  it('stages only the selected hunk via stdin', async () => {
    const root = fixture()
    expect(await changeHunk(root, await request(root), 'stage')).toEqual({ ok: true })
    expect(git(root, ['show', ':a.txt'])).toContain('changed 2\n')
    expect(git(root, ['show', ':a.txt'])).toContain('line 25\n')
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toContain('changed 25\n')
  })
  it('reverts only the selected hunk and preserves the index', async () => {
    const root = fixture()
    expect(await changeHunk(root, await request(root), 'revert')).toEqual({ ok: true })
    const text = readFileSync(join(root, 'a.txt'), 'utf8')
    expect(text).toContain('line 2\n')
    expect(text).toContain('changed 25\n')
    expect(git(root, ['diff', '--cached'])).toBe('')
  })
  it('refuses stale mtimes, changed hunk contents and traversal without writing', async () => {
    const root = fixture()
    const original = await request(root)
    expect(await changeHunk(root, { ...original, path: '../a.txt' }, 'revert')).toMatchObject({ ok: false })
    writeFileSync(join(root, 'a.txt'), 'someone else wrote this\n')
    expect(await changeHunk(root, original, 'revert')).toMatchObject({ ok: false, conflict: true })
    expect(await changeHunk(root, { ...original, expectedMtime: statSync(join(root, 'a.txt')).mtimeMs }, 'stage')).toMatchObject({ ok: false, conflict: true })
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('someone else wrote this\n')
    expect(git(root, ['diff', '--cached'])).toBe('')
  })
  it('refuses when the index has already staged this hunk', async () => {
    const root = fixture()
    const original = await request(root)
    git(root, ['add', 'a.txt'])
    expect(await changeHunk(root, original, 'stage')).toMatchObject({ ok: false, conflict: true })
  })
  it('pins patch prefixes so git configuration cannot redirect a subproject revert', async () => {
    const root = fixture()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/a.txt'), git(root, ['show', 'HEAD:a.txt']))
    git(root, ['add', 'src/a.txt'])
    git(root, ['commit', '-qm', 'subproject'])
    writeFileSync(join(root, 'src/a.txt'), readFileSync(join(root, 'a.txt'), 'utf8'))
    git(root, ['config', 'diff.noprefix', 'true'])
    const diff = git(root, ['diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', 'HEAD', '--', 'src/a.txt'])
    const hunk = diffHunks(diff)[0]
    const request = { path: 'src/a.txt', ...hunk.coordinates, expectedMtime: statSync(join(root, 'src/a.txt')).mtimeMs, expectedHunk: hunk.text }
    expect(await changeHunk(join(root, 'src'), request, 'revert')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'src/a.txt'), 'utf8')).toContain('line 2\n')
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toContain('changed 2\n')
  })
  it('stages and reverts an untracked file hunk', async () => {
    const root = fixture()
    writeFileSync(join(root, 'new.txt'), 'hello\n')
    const hunk = { path: 'new.txt', oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, expectedMtime: statSync(join(root, 'new.txt')).mtimeMs, expectedHunk: '@@ -0,0 +1 @@\n+hello\n' }
    expect(await changeHunk(root, hunk, 'stage')).toEqual({ ok: true })
    expect(git(root, ['show', ':new.txt'])).toBe('hello\n')
    git(root, ['reset', '-q', '--', 'new.txt'])
    expect(await changeHunk(root, hunk, 'revert')).toEqual({ ok: true })
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
  })
  it('stages a deleted file and restores it only while the path remains absent', async () => {
    const root = fixture()
    unlinkSync(join(root, 'a.txt'))
    const diff = git(root, ['diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', 'HEAD', '--', 'a.txt'])
    const selected = diffHunks(diff)[0]
    const hunk = { path: 'a.txt', ...selected.coordinates, expectedMtime: 0, expectedHunk: selected.text }
    expect(await changeHunk(root, hunk, 'stage')).toEqual({ ok: true })
    expect(git(root, ['ls-files', '--', 'a.txt'])).toBe('')
    expect(await changeHunk(root, hunk, 'revert')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toContain('line 2\n')
    expect(await changeHunk(root, hunk, 'revert')).toMatchObject({ ok: false, conflict: true })
  })
  it('handles a deleted file whose empty parent directory is also gone', async () => {
    const root = fixture()
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'nested/only.txt'), 'original\n')
    git(root, ['add', 'nested/only.txt'])
    git(root, ['commit', '-qm', 'nested file'])
    rmSync(join(root, 'nested'), { recursive: true })
    const diff = git(root, ['diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', 'HEAD', '--', 'nested/only.txt'])
    const selected = diffHunks(diff)[0]
    const hunk = { path: 'nested/only.txt', ...selected.coordinates, expectedMtime: 0, expectedHunk: selected.text }
    expect(await changeHunk(root, hunk, 'stage')).toEqual({ ok: true })
    expect(await changeHunk(root, hunk, 'revert')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'nested/only.txt'), 'utf8')).toBe('original\n')
  })
})
