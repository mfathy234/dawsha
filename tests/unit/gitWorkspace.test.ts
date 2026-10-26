import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileAgainstBase, fileDiffSince, projectFiles, readProjectFile, resolveProjectPath, sessionBaseline, sessionStatus, writeProjectFile } from '../../src/main/gitWorkspace'

const IDENTITY = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim()

function makeRepo(): string {
  const repo = join(mkdtempSync(join(tmpdir(), 'dawsha-workspace-')), 'acme-web')
  mkdirSync(join(repo, 'src'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, '.gitignore'), 'dist/\n')
  writeFileSync(join(repo, 'src', 'a.ts'), 'one\n')
  writeFileSync(join(repo, 'src', 'b.ts'), 'one\n')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  return repo
}

describe('project files', () => {
  it('lists tracked and untracked files but not ignored ones', async () => {
    const repo = makeRepo()
    mkdirSync(join(repo, 'dist'))
    writeFileSync(join(repo, 'dist', 'bundle.js'), 'x')
    writeFileSync(join(repo, 'src', 'new.ts'), 'fresh\n')
    const result = await projectFiles(repo)
    expect(result).toEqual({ ok: true, files: ['.gitignore', 'README.md', 'src/a.ts', 'src/b.ts', 'src/new.ts'], truncated: false, repo: true, prefix: '' })
  })

  it('lists a sub folder, also when it is reached through a symlink', async () => {
    const repo = makeRepo()
    expect(await projectFiles(join(repo, 'src'))).toMatchObject({ ok: true, files: ['src/a.ts', 'src/b.ts'] })
    if (process.platform === 'win32') return
    const link = join(mkdtempSync(join(tmpdir(), 'dawsha-link-')), 'linked')
    symlinkSync(repo, link)
    expect(await projectFiles(link)).toMatchObject({ ok: true, files: ['.gitignore', 'README.md', 'src/a.ts', 'src/b.ts'] })
    expect(await projectFiles(join(link, 'src'))).toMatchObject({ ok: true, files: ['src/a.ts', 'src/b.ts'] })
  })

  it('reads a file and refuses paths outside the project', async () => {
    const repo = makeRepo()
    expect(await readProjectFile(repo, 'src/a.ts')).toMatchObject({ ok: true, text: 'one\n', size: 4, mtimeMs: expect.any(Number) })
    expect(await readProjectFile(repo, '../secret.txt')).toMatchObject({ ok: false })
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
    expect(await readProjectFile(repo, 'logo.png')).toMatchObject({ ok: true, text: null, reason: 'binary' })
  })
})

const mtimeOf = async (repo: string, path: string): Promise<number> => {
  const read = await readProjectFile(repo, path)
  if (!read.ok) throw new Error(read.error)
  return read.mtimeMs
}

describe('saving project files', () => {
  it('round-trips a write and returns the new mtime', async () => {
    const repo = makeRepo()
    const saved = await writeProjectFile(repo, 'src/a.ts', 'two\n', await mtimeOf(repo, 'src/a.ts'))
    expect(saved).toMatchObject({ ok: true, mtimeMs: expect.any(Number) })
    expect(readFileSync(join(repo, 'src', 'a.ts'), 'utf8')).toBe('two\n')
    expect(await mtimeOf(repo, 'src/a.ts')).toBe((saved as { mtimeMs: number }).mtimeMs)
  })

  it('reports a conflict instead of overwriting a file that changed on disk', async () => {
    const repo = makeRepo()
    const stale = await mtimeOf(repo, 'src/a.ts')
    const later = (Date.now() + 5000) / 1000
    writeFileSync(join(repo, 'src', 'a.ts'), 'theirs\n')
    utimesSync(join(repo, 'src', 'a.ts'), later, later)
    expect(await writeProjectFile(repo, 'src/a.ts', 'mine\n', stale)).toMatchObject({ ok: false, conflict: true })
    expect(readFileSync(join(repo, 'src', 'a.ts'), 'utf8')).toBe('theirs\n')
  })

  it('keeps CRLF line endings', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'win.txt'), 'a\r\nb\r\n')
    expect(await writeProjectFile(repo, 'win.txt', 'a\nb\nc\n', await mtimeOf(repo, 'win.txt'))).toMatchObject({ ok: true })
    expect(readFileSync(join(repo, 'win.txt'), 'utf8')).toBe('a\r\nb\r\nc\r\n')
  })

  it('refuses paths outside the project, binary files and bad input', async () => {
    const repo = makeRepo()
    expect(await writeProjectFile(repo, '../x', 'pwn', 0)).toMatchObject({ ok: false })
    expect(await writeProjectFile(repo, '/etc/passwd', 'pwn', 0)).toMatchObject({ ok: false })
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
    expect(await writeProjectFile(repo, 'logo.png', 'x', await mtimeOf(repo, 'logo.png'))).toMatchObject({ ok: false })
    expect(await writeProjectFile(repo, 'src/a.ts', 5, 0)).toMatchObject({ ok: false })
    expect(await writeProjectFile(repo, 'src/a.ts', 'x', Number.NaN)).toEqual({ ok: false, error: 'Invalid save request.' })
    expect(await writeProjectFile(repo, 'src/a.ts', 'x', Infinity)).toEqual({ ok: false, error: 'Invalid save request.' })
    if (process.platform === 'win32') expect(await writeProjectFile(repo, 'src/a.ts:stream', 'x', 0)).toMatchObject({ ok: false })
    expect(await writeProjectFile(repo, 'src/a.ts', 'x'.repeat(1024 * 1024 + 1), 0)).toMatchObject({ ok: false })
  })

  it('refuses a link that points outside the project, for reads and writes', async () => {
    const repo = makeRepo()
    const outside = join(mkdtempSync(join(tmpdir(), 'dawsha-outside-')), 'secret')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.txt'), 'top secret\n')
    // a junction needs no privileges on Windows; a file symlink may, so it is tried separately
    symlinkSync(outside, join(repo, 'escape'), 'junction')
    expect(await readProjectFile(repo, 'escape/secret.txt')).toMatchObject({ ok: false })
    expect(await writeProjectFile(repo, 'escape/secret.txt', 'pwn', 0)).toMatchObject({ ok: false })
    let fileLink = true
    try {
      symlinkSync(join(outside, 'secret.txt'), join(repo, 'leak.txt'), 'file')
    } catch {
      fileLink = false
    }
    if (fileLink) {
      expect(await readProjectFile(repo, 'leak.txt')).toMatchObject({ ok: false })
      expect(await writeProjectFile(repo, 'leak.txt', 'pwn', 0)).toMatchObject({ ok: false })
    }
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('top secret\n')
  })
})

describe('file against the merge base', () => {
  it('returns the committed text next to the working copy, and null for a new file', async () => {
    const repo = makeRepo()
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(repo, 'src', 'a.ts'), 'one\ntwo\n')
    git(repo, 'commit', '-q', '-am', 'edit')
    writeFileSync(join(repo, 'src', 'a.ts'), 'one\ntwo\nthree\n')
    writeFileSync(join(repo, 'src', 'new.ts'), 'fresh\n')
    expect(await fileAgainstBase(repo, 'src/a.ts')).toEqual({ ok: true, base: 'one\n', text: 'one\ntwo\nthree\n' })
    expect(await fileAgainstBase(repo, 'src/new.ts')).toEqual({ ok: true, base: null, text: 'fresh\n' })
    expect(await fileAgainstBase(repo, '../x')).toMatchObject({ ok: false })
  })

  it('returns the base text next to an empty file for a deleted file', async () => {
    const repo = makeRepo()
    rmSync(join(repo, 'src', 'b.ts'))
    expect(await fileAgainstBase(repo, 'src/b.ts')).toEqual({ ok: true, base: 'one\n', text: '', deleted: true })
    expect(await fileAgainstBase(repo, 'src/never.ts')).toMatchObject({ ok: false })
  })
})

describe('this session', () => {
  it('lists only what changed after the session started, without touching the stash', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'src', 'a.ts'), 'one\nbefore the session\n')
    writeFileSync(join(repo, 'old-note.txt'), 'already here\n')
    const old = (Date.now() - 60_000) / 1000
    utimesSync(join(repo, 'old-note.txt'), old, old)
    const started = await sessionBaseline(repo)
    if (!started.ok) throw new Error(started.error)
    expect(started.baseline.ref).toMatch(/^[0-9a-f]{40}$/)
    expect(started.baseline.untracked).toEqual(['old-note.txt'])
    expect(git(repo, 'stash', 'list')).toBe('')

    writeFileSync(join(repo, 'src', 'b.ts'), 'one\nsession edit\n')
    writeFileSync(join(repo, 'src', 'a.ts'), 'one\nbefore the session\nand during it\n')
    writeFileSync(join(repo, 'src', 'made.ts'), 'by the agent\n')
    const result = await sessionStatus(repo, started.baseline)
    if (!result.ok) throw new Error(result.error)
    expect(result.fellBack).toBe(false)
    const files = result.status.files.map((file) => [file.path, file.added, file.removed])
    expect(files).toEqual(expect.arrayContaining([['src/a.ts', 1, 0], ['src/b.ts', 1, 0], ['src/made.ts', 1, 0]]))
    expect(files.map((file) => file[0])).not.toContain('old-note.txt')

    const diff = await fileDiffSince(repo, 'src/a.ts', started.baseline)
    expect(diff.ok && diff.text).toContain('+and during it')
    expect(diff.ok && diff.text).not.toContain('+before the session')
  })

  it('falls back to every change when the starting commit no longer exists', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'src', 'a.ts'), 'changed\n')
    const result = await sessionStatus(repo, { ref: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', at: Date.now(), untracked: [] })
    expect(result.ok && result.fellBack).toBe(true)
    expect(result.ok && result.status.files.map((file) => file.path)).toEqual(['src/a.ts'])
  })
})

describe('files that are not UTF-8', () => {
  it('refuses to show or save a CP1252 file instead of corrupting it', async () => {
    const repo = makeRepo()
    const bytes = Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9]), Buffer.from('\n')])
    writeFileSync(join(repo, 'latin.txt'), bytes)
    expect(await readProjectFile(repo, 'latin.txt')).toMatchObject({ ok: true, text: null, reason: 'encoding' })
    const read = await readProjectFile(repo, 'latin.txt')
    const mtime = read.ok ? read.mtimeMs : 0
    expect(await writeProjectFile(repo, 'latin.txt', 'cafe\n', mtime)).toMatchObject({ ok: false })
    expect(readFileSync(join(repo, 'latin.txt'))).toEqual(bytes)
  })

  it('still reads UTF-8 with a BOM and multibyte text', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'u.txt'), '﻿café ✓\n', 'utf8')
    expect(await readProjectFile(repo, 'u.txt')).toMatchObject({ ok: true, text: '﻿café ✓\n' })
  })
})

describe('a project that is a sub folder of its repository', () => {
  it('lists its prefix and keeps reads and writes inside it', async () => {
    const repo = makeRepo()
    const sub = join(repo, 'src')
    const listing = await projectFiles(sub)
    expect(listing).toMatchObject({ ok: true, files: ['src/a.ts', 'src/b.ts'], prefix: 'src' })
    expect(await readProjectFile(sub, 'src/a.ts')).toMatchObject({ ok: true, text: 'one\n' })
    expect(await readProjectFile(sub, 'README.md')).toMatchObject({ ok: false })
    const read = await readProjectFile(sub, 'src/a.ts')
    const mtime = read.ok ? read.mtimeMs : 0
    expect(await writeProjectFile(sub, 'README.md', 'pwn', mtime)).toMatchObject({ ok: false })
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('hello\n')
    expect(await writeProjectFile(sub, 'src/a.ts', 'two\n', mtime)).toMatchObject({ ok: true })
    expect(await resolveProjectPath(sub, 'src/a.ts')).toBe(join(repo, 'src', 'a.ts'))
    expect(await resolveProjectPath(sub, 'README.md')).toBeNull()
  })
})

describe('a file deleted on disk while it is open', () => {
  it('is written again on save when its folder is still in the project', async () => {
    const repo = makeRepo()
    rmSync(join(repo, 'src', 'b.ts'))
    expect(await writeProjectFile(repo, 'src/b.ts', 'back\n', 0)).toMatchObject({ ok: true, mtimeMs: expect.any(Number) })
    expect(readFileSync(join(repo, 'src', 'b.ts'), 'utf8')).toBe('back\n')
    expect(await writeProjectFile(repo, 'src/missing-dir/x.ts', 'x', 0)).toMatchObject({ ok: false })
    expect(await writeProjectFile(repo, '../out.ts', 'x', 0)).toMatchObject({ ok: false })
  })
})

describe('outside git', () => {
  it('says there is no base to compare with', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawsha-nogit-'))
    writeFileSync(join(dir, 'a.txt'), 'x\n')
    expect(await fileAgainstBase(dir, 'a.txt')).toEqual({ ok: true, base: null, text: 'x\n', reason: 'norepo' })
  })
})
