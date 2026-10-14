import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileDiffSince, projectFiles, readProjectFile, sessionBaseline, sessionStatus } from '../../src/main/gitWorkspace'

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
    expect(result).toEqual({ ok: true, files: ['.gitignore', 'README.md', 'src/a.ts', 'src/b.ts', 'src/new.ts'], truncated: false, repo: true })
  })

  it('reads a file and refuses paths outside the project', async () => {
    const repo = makeRepo()
    expect(await readProjectFile(repo, 'src/a.ts')).toEqual({ ok: true, text: 'one\n', size: 4 })
    expect(await readProjectFile(repo, '../secret.txt')).toMatchObject({ ok: false })
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
    expect(await readProjectFile(repo, 'logo.png')).toMatchObject({ ok: true, text: null, reason: 'binary' })
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
