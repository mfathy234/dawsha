import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeKnownDirs, npmClaudeBinary, scanClaudeInstalls } from '../../src/main/claudeInstalls'

const roots: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dawsha-claude-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const SHIM = '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n'

/** What `npm install -g @anthropic-ai/claude-code` leaves in a Windows prefix: three shims and the package. */
function windowsNpmPrefix(prefix: string): void {
  const bin = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude.exe'), 'MZ')
  writeFileSync(join(prefix, 'claude.cmd'), SHIM)
  writeFileSync(join(prefix, 'claude.ps1'), '& "$basedir/node_modules/@anthropic-ai/claude-code/bin/claude.exe" $args')
  writeFileSync(join(prefix, 'claude'), '#!/bin/sh\nexec "$basedir/node_modules/@anthropic-ai/claude-code/bin/claude.exe" "$@"\n')
}

describe('scanClaudeInstalls', () => {
  it('finds an npm install whose prefix is not on PATH, as one install', () => {
    const prefix = temp()
    windowsNpmPrefix(prefix)
    const found = scanClaudeInstalls({ pathDirs: [], extraDirs: [prefix], platform: 'win32' })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ path: join(prefix, 'claude.cmd'), kind: 'npm', npmPrefix: prefix, onPath: false })
    expect(npmClaudeBinary(found[0])).toBe(join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  })

  it('finds an npm install in a version-manager folder that is on PATH', () => {
    const prefix = temp()
    windowsNpmPrefix(prefix)
    const found = scanClaudeInstalls({ pathDirs: [prefix], extraDirs: [], platform: 'win32' })
    expect(found.map((i) => [i.kind, i.onPath])).toEqual([['npm', true]])
  })

  it('reports a native and an npm install together, in PATH order', () => {
    const prefix = temp()
    windowsNpmPrefix(prefix)
    const home = temp()
    const nativeBin = join(home, '.local', 'bin')
    mkdirSync(nativeBin, { recursive: true })
    writeFileSync(join(nativeBin, 'claude.exe'), 'MZ')
    const found = scanClaudeInstalls({ pathDirs: [nativeBin, prefix], extraDirs: [], platform: 'win32' })
    expect(found.map((i) => i.kind)).toEqual(['native', 'npm'])
    expect(found.every((i) => i.onPath)).toBe(true)
    const swapped = scanClaudeInstalls({ pathDirs: [prefix], extraDirs: [nativeBin], platform: 'win32' })
    expect(swapped.map((i) => [i.kind, i.onPath])).toEqual([
      ['npm', true],
      ['native', false]
    ])
  })

  it('finds nothing in empty folders', () => {
    expect(scanClaudeInstalls({ pathDirs: [temp()], extraDirs: [temp()], platform: 'win32' })).toEqual([])
  })

  it('follows a symlink into node_modules to classify an extensionless Unix launcher', () => {
    const prefix = temp()
    const target = join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'claude.exe'), 'x')
    mkdirSync(join(prefix, 'bin'))
    try {
      symlinkSync(join(target, 'claude.exe'), join(prefix, 'bin', 'claude'))
    } catch {
      return
    }
    const [found] = scanClaudeInstalls({ pathDirs: [join(prefix, 'bin')], extraDirs: [], platform: 'linux' })
    expect(found?.kind).toBe('npm')
    expect(found?.npmPrefix?.toLowerCase().endsWith(prefix.slice(-8).toLowerCase())).toBe(true)
  })
})

describe('claudeKnownDirs', () => {
  it('lists the npm, native, Volta and legacy folders a GUI app may not have on PATH', () => {
    const win = claudeKnownDirs('win32', 'C:\\Users\\dev', { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming', NVM_SYMLINK: 'C:\\nvm4w\\nodejs' })
    expect(win).toEqual(
      expect.arrayContaining([
        join('C:\\Users\\dev', '.local', 'bin'),
        join('C:\\Users\\dev\\AppData\\Roaming', 'npm'),
        'C:\\nvm4w\\nodejs',
        join('C:\\Users\\dev', '.claude', 'local')
      ])
    )
    const linux = claudeKnownDirs('linux', '/home/dev', {})
    expect(linux).toEqual(expect.arrayContaining([join('/home/dev', '.local', 'bin'), join('/home/dev', '.npm-global', 'bin'), '/usr/local/bin']))
  })
})
