import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyWorktreeEnvironment, inspectWorktreeSetup, isPathInside, saveWorktreeSetup } from '../../src/main/worktreeEnvironment'
import { createWorktree, createWorktrees } from '../../src/main/compare'
import { createSessionWorktree } from '../../src/main/sessionWorktree'
import { claimPendingWorktree } from '../../src/main/worktreeSetupPending'

const roots: string[] = []
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-setup-')); roots.push(root)
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', root, 'config', 'core.autocrlf', 'false'])
  writeFileSync(join(root, '.gitignore'), '.env*\nconfig/\n*.pem\nnode_modules/\n')
  writeFileSync(join(root, 'package-lock.json'), '{}')
  execFileSync('git', ['-C', root, 'add', '.'])
  execFileSync('git', ['-C', root, 'commit', '-qm', 'initial'])
  return realpathSync.native(root)
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('worktree environment safety', () => {
  it('checks canonical path boundaries without accepting sibling prefixes', () => {
    expect(isPathInside('C:\\repo', 'C:\\repo\\config\\dev.json', 'win32')).toBe(true)
    expect(isPathInside('C:\\repo', 'c:\\REPO\\file', 'win32')).toBe(true)
    expect(isPathInside('C:\\repo', 'C:\\repo-other\\file', 'win32')).toBe(false)
    expect(isPathInside('/repo', '/repo/../outside')).toBe(false)
    expect(isPathInside('/repo', '/repo')).toBe(false)
  })
  it('inspects the main checkout even when opened from a linked worktree', async () => {
    const root = repo(); const linked = join(root, 'linked')
    execFileSync('git', ['-C', root, 'worktree', 'add', '-qb', 'other', linked])
    writeFileSync(join(root, '.env'), 'PRIVATE=local')
    writeFileSync(join(root, '.env.example'), 'PRIVATE=example')
    mkdirSync(join(root, 'node_modules')); writeFileSync(join(root, 'node_modules', '.env'), 'skip')
    const result = await inspectWorktreeSetup(linked)
    expect(result.ok && result.suggestions).toEqual(['.env'])
    expect(result.ok && result.commands.map((item) => item.command)).toContain('npm ci')
    expect(await saveWorktreeSetup(linked, '.env\n')).toEqual({ ok: true })
    expect(readFileSync(join(root, '.worktreeinclude'), 'utf8')).toBe('.env\n')
    expect(existsSync(join(linked, '.worktreeinclude'))).toBe(false)
  })
  it('copies ignored selections only, with negation and explicit private key opt-in', async () => {
    const root = repo(); const destination = join(root, 'destination'); mkdirSync(destination)
    writeFileSync(join(root, '.worktreeinclude'), '.env*\n!.env.example\n*.pem\npackage-lock.json\n')
    writeFileSync(join(root, '.env'), 'PRIVATE=local'); writeFileSync(join(root, '.env.example'), 'example'); writeFileSync(join(root, 'cert.pem'), 'chosen')
    expect(await copyWorktreeEnvironment(root, destination)).toEqual({ ok: true, files: 2, bytes: 19 })
    expect(readFileSync(join(destination, '.env'), 'utf8')).toBe('PRIVATE=local')
    expect(existsSync(join(destination, 'package-lock.json'))).toBe(false)
    expect(existsSync(join(destination, '.env.example'))).toBe(false)
    writeFileSync(join(destination, '.env'), 'changed')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('PRIVATE=local')
  })
  it('fails before copying when selections exceed the size limit', async () => {
    const root = repo(); const destination = join(root, 'destination'); mkdirSync(destination)
    writeFileSync(join(root, '.worktreeinclude'), '.env*\n'); writeFileSync(join(root, '.env'), '12345'); writeFileSync(join(root, '.env.local'), '67890')
    const result = await copyWorktreeEnvironment(root, destination, 8)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/limit/i)
    expect(existsSync(join(destination, '.env'))).toBe(false)
  })
  it('refuses outside source and destination junctions', async () => {
    const root = repo(); const outside = mkdtempSync(join(tmpdir(), 'dawsha-outside-')); roots.push(outside)
    const destination = join(root, 'destination'); mkdirSync(destination)
    writeFileSync(join(root, '.worktreeinclude'), 'config/\n'); writeFileSync(join(outside, '.env'), 'private')
    symlinkSync(outside, join(root, 'config'), 'junction')
    expect((await copyWorktreeEnvironment(root, destination)).ok).toBe(false)
    rmdirSync(join(root, 'config')); mkdirSync(join(root, 'config')); writeFileSync(join(root, 'config', '.env'), 'local')
    symlinkSync(outside, join(destination, 'config'), 'junction')
    expect((await copyWorktreeEnvironment(root, destination)).ok).toBe(false)
    expect(readFileSync(join(outside, '.env'), 'utf8')).toBe('private')
  })
  it('refuses an external include file for both reads and writes', async () => {
    const root = repo(); const outside = mkdtempSync(join(tmpdir(), 'dawsha-outside-')); roots.push(outside)
    writeFileSync(join(outside, 'include'), '.env\n'); symlinkSync(outside, join(root, '.worktreeinclude'), 'junction')
    expect((await inspectWorktreeSetup(root)).ok).toBe(false)
    expect((await saveWorktreeSetup(root, 'replacement')).ok).toBe(false)
    expect(readFileSync(join(outside, 'include'), 'utf8')).toBe('.env\n')
  })
  it('copies local files and registers terminal setup through every worktree creation boundary', async () => {
    const root = repo()
    writeFileSync(join(root, '.worktreeinclude'), '.env\n'); writeFileSync(join(root, '.env'), 'COPIED=yes')
    const single = await createSessionWorktree(root, 'env001')
    const run = await createWorktree(root, 'env002')
    const compare = await createWorktrees(root, 'env003')
    if (!single.ok || !run.ok || !compare.ok) throw new Error('A test worktree could not be created.')
    const paths = [single.path, run.side.path, compare.sides.a.path, compare.sides.b.path]
    roots.push(...paths)
    for (const path of paths) {
      expect(readFileSync(join(path, '.env'), 'utf8')).toBe('COPIED=yes')
      expect(realpathSync.native(claimPendingWorktree(path)!.repo)).toBe(root)
    }
  })
  it('rolls back new worktrees and branches when copying cannot finish safely', async () => {
    const root = repo(); const outside = mkdtempSync(join(tmpdir(), 'dawsha-outside-')); roots.push(outside)
    writeFileSync(join(root, '.worktreeinclude'), 'config/\n'); writeFileSync(join(outside, '.env'), 'outside'); symlinkSync(outside, join(root, 'config'), 'junction')
    const result = await createSessionWorktree(root, 'env004')
    expect(result.ok).toBe(false)
    expect(existsSync(`${root}-preset-env004`)).toBe(false)
    expect(execFileSync('git', ['-C', root, 'branch', '--list', 'preset/env004'], { encoding: 'utf8' }).trim()).toBe('')
    expect((await createWorktrees(root, 'env005')).ok).toBe(false)
    expect(existsSync(`${root}-compare-env005-a`)).toBe(false)
    expect(execFileSync('git', ['-C', root, 'branch', '--list', 'compare/env005-a'], { encoding: 'utf8' }).trim()).toBe('')
  })
})
