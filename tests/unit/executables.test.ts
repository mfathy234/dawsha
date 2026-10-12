import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { platformExecutableDirs } from '../../src/main/executables'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('platform executable directories', () => {
  it('discovers Node version bin folders used by macOS shell managers', () => {
    const home = mkdtempSync(join(tmpdir(), 'dawsha-home-'))
    roots.push(home)
    mkdirSync(join(home, '.nvm', 'versions', 'node', 'v24.1.0', 'bin'), { recursive: true })
    mkdirSync(join(home, '.local', 'share', 'fnm', 'node-versions', 'v23.0.0', 'installation', 'bin'), { recursive: true })
    const dirs = platformExecutableDirs('darwin', home)
    expect(dirs).toContain(join(home, '.nvm', 'versions', 'node', 'v24.1.0', 'bin'))
    expect(dirs).toContain(join(home, '.local', 'share', 'fnm', 'node-versions', 'v23.0.0', 'installation', 'bin'))
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(platformExecutableDirs('win32', home)).toEqual([])
  })
})
