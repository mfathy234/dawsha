import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseWorktrees, listFilesWorkspaces } from '../../src/main/filesWorkspace'
import { trashProjectPath } from '../../src/main/filesTrash'
import { checkoutTabsKey } from '../../src/shared/filesWorkspace'
import { migrateSettings } from '../../src/shared/settingsSchema'

describe('Files workspaces', () => {
  it('parses NUL records without trimming newline paths, detached and missing entries', () => {
    expect(parseWorktrees('worktree /main\nfolder\0HEAD abcdef123\0branch refs/heads/main\0\0worktree /other\0HEAD 123456789\0detached\0prunable gone\0\0')).toEqual([
      { folder: '/main\nfolder', branch: 'main', head: 'abcdef123', detached: false, unavailable: false, main: true },
      { folder: '/other', branch: '', head: '123456789', detached: true, unavailable: true, main: false }
    ])
  })
  it('migrates legacy project tabs into the project checkout key', () => {
    const settings = migrateSettings({ projects: [{ id: 'p', name: 'App', folder: 'C:\\App' }], filesTabs: { p: ['a.txt'] } })
    expect(settings.filesTabs).toEqual({ [checkoutTabsKey('p', 'c:/app')]: ['a.txt'] })
  })
  it('keeps checkout tabs separate and preserves valid canonical keys', () => {
    const a = checkoutTabsKey('p', 'C:\\App'), b = checkoutTabsKey('p', 'C:\\Other')
    const settings = migrateSettings({ projects: [{ id: 'p', name: 'App', folder: 'C:\\App' }], filesTabs: { [a]: ['a.txt'], [b]: ['b.txt'] } })
    expect(settings.filesTabs).toEqual({ [a]: ['a.txt'], [b]: ['b.txt'] })
  })
  it('lists configured non-Git folders and refuses unknown folders', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'files-workspaces-'))
    expect(await listFilesWorkspaces([{ id: 'p', folder }], 'p')).toMatchObject({ ok: true, git: false, checkouts: [{ folder, branch: '' }] })
    expect(await listFilesWorkspaces([], 'p')).toMatchObject({ ok: false })
    const alias = `${folder}-alias`
    await symlink(folder, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await listFilesWorkspaces([{ id: 'p', folder: alias }], 'p', alias)).toMatchObject({ ok: true, folder })
    const outside = await mkdtemp(join(tmpdir(), 'files-unknown-'))
    expect(await listFilesWorkspaces([{ id: 'p', folder }], 'p', outside)).toMatchObject({ ok: false })
  })
  it('discovers real main, linked, detached, missing and unborn checkouts', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'files-git-'))
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: folder, encoding: 'utf8' })
    git('init', '-qb', 'unborn')
    expect(await listFilesWorkspaces([{ id: 'p', folder }], 'p')).toMatchObject({ ok: true, git: true, checkouts: [{ branch: 'unborn', main: true }] })
    await writeFile(join(folder, 'a.txt'), 'a')
    git('add', '.')
    git('commit', '-qm', 'first')
    const linked = join(folder, 'linked')
    git('worktree', 'add', '-q', '--detach', linked)
    const result = await listFilesWorkspaces([{ id: 'p', folder }], 'p')
    expect(result).toMatchObject({ ok: true, checkouts: [{ branch: 'unborn', main: true }, { detached: true, main: false }] })
    // A missing registered checkout stays visible and unavailable, rather than silently disappearing.
    const { rm } = await import('node:fs/promises')
    await rm(linked, { recursive: true })
    expect(await listFilesWorkspaces([{ id: 'p', folder }], 'p')).toMatchObject({ ok: true, checkouts: [{ unavailable: false }, { unavailable: true }] })
  })
})

describe('Trash boundaries', () => {
  it('trashes an ordinary descendant through the injected operation only', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'files-trash-'))
    await writeFile(join(folder, 'a.txt'), 'a')
    const trashed: string[] = []
    expect(await trashProjectPath([{ folder }], folder, 'a.txt', async p => { trashed.push(p) })).toEqual({ ok: true })
    expect(trashed).toEqual([join(folder, 'a.txt')])
  })
  it('rejects root, traversal, Git metadata, missing paths and unknown folders', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'files-trash-'))
    await mkdir(join(folder, '.git'))
    const trash = async (): Promise<void> => { throw new Error('must not trash') }
    for (const path of ['', '.', '../outside', '.git', '.git/config', '/outside', 'missing']) {
      expect(await trashProjectPath([{ folder }], folder, path, trash)).toMatchObject({ ok: false })
    }
    expect(await trashProjectPath([], folder, 'a.txt', trash)).toMatchObject({ ok: false })
    await writeFile(join(folder, '.git', 'config'), 'metadata')
    expect(await trashProjectPath([{ folder: join(folder, '.git') }], join(folder, '.git'), 'config', async () => {})).toMatchObject({ ok: false })
    if (process.platform === 'win32') expect(await trashProjectPath([{ folder }], folder, '.git.', async () => {})).toMatchObject({ ok: false })
  })
  it('refuses symlink ancestors and surfaces trash failures', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'files-trash-'))
    const other = await mkdtemp(join(tmpdir(), 'files-other-'))
    await writeFile(join(other, 'a.txt'), 'a')
    await symlink(other, join(folder, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await trashProjectPath([{ folder }], folder, 'link/a.txt', async () => {})).toMatchObject({ ok: false })
    await writeFile(join(folder, 'a.txt'), 'a')
    expect(await trashProjectPath([{ folder }], folder, 'a.txt', async () => { throw new Error('Trash unavailable') })).toEqual({ ok: false, error: 'Trash unavailable' })
  })
  it('refuses folders containing nested checkout metadata or symlinks', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'files-trash-'))
    await mkdir(join(folder, 'nested', '.git'), { recursive: true })
    expect(await trashProjectPath([{ folder }], folder, 'nested', async () => {})).toMatchObject({ ok: false })
    const other = await mkdtemp(join(tmpdir(), 'files-other-'))
    await mkdir(join(folder, 'links'))
    await symlink(other, join(folder, 'links', 'external'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await trashProjectPath([{ folder }], folder, 'links', async () => {})).toMatchObject({ ok: false })
  })
})
