import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSetupCommand } from '../../src/main/worktreeSetupCommand'

describe('worktree setup commands', () => {
  it.runIf(process.platform === 'win32')('stops after a failed command instead of hiding it behind the next stack', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dawsha-setup-command-'))
    const setup = createSetupCommand('cmd /c exit 7\necho should-not-run > hidden-failure.txt')
    try {
      expect(() => execFileSync(setup.spec.file, setup.spec.args, { cwd, windowsHide: true, stdio: 'pipe' })).toThrow()
      expect(existsSync(join(cwd, 'hidden-failure.txt'))).toBe(false)
    } finally {
      setup.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'win32')('runs multiline setup in its own cwd and removes its temporary script', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dawsha-setup-command-'))
    const setup = createSetupCommand('echo first > ready.txt\necho second >> ready.txt')
    try {
      execFileSync(setup.spec.file, setup.spec.args, { cwd, windowsHide: true, stdio: 'pipe' })
      expect(readFileSync(join(cwd, 'ready.txt'), 'utf8')).toContain('second')
      const script = setup.spec.args.at(-1)!
      expect(existsSync(script)).toBe(true)
      setup.dispose()
      expect(existsSync(script)).toBe(false)
    } finally {
      setup.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'win32')('starts each stack command in the worktree root', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dawsha-setup-command-'))
    mkdirSync(join(cwd, 'api'))
    mkdirSync(join(cwd, 'web'))
    const setup = createSetupCommand('cd "api" && echo restored > ready.txt\ncd "web" && echo installed > ready.txt')
    try {
      execFileSync(setup.spec.file, setup.spec.args, { cwd, windowsHide: true, stdio: 'pipe' })
      expect(readFileSync(join(cwd, 'api', 'ready.txt'), 'utf8')).toContain('restored')
      expect(readFileSync(join(cwd, 'web', 'ready.txt'), 'utf8')).toContain('installed')
    } finally {
      setup.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
