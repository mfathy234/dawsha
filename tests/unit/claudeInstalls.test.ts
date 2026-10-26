import { describe, expect, it } from 'vitest'
import { claudeConflict, classifyClaudeInstall, npmInstallCommand, type ClaudeInstall } from '../../src/shared/claudeInstalls'
import {
  CLAUDE_NATIVE_INSTALL,
  CLAUDE_NATIVE_INSTALL_UNIX,
  planFor,
  toolCommand,
  type ToolReport
} from '../../src/shared/agentTools'

const WIN_SHIM = '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*'
const SH_SHIM = 'exec "$basedir/node_modules/@anthropic-ai/claude-code/bin/claude.exe"   "$@"'
const WIN_NPM = 'C:\\Users\\dev\\AppData\\Roaming\\npm'

const install = (patch: Partial<ClaudeInstall>): ClaudeInstall => ({
  path: 'C:\\Users\\dev\\.local\\bin\\claude.exe',
  kind: 'native',
  npmPrefix: null,
  legacyLocal: false,
  onPath: true,
  version: '2.1.310',
  ...patch
})

const claude = (patch: Partial<ToolReport> = {}): ToolReport => ({
  agent: 'claude',
  installed: '2.1.289',
  present: true,
  latest: '2.1.310',
  latestFailed: false,
  installKind: 'npm',
  platform: 'win32',
  ...patch
})

describe('classifyClaudeInstall', () => {
  it('treats the .cmd, .ps1 and extensionless npm shims as npm installs owned by their folder', () => {
    for (const name of ['claude.cmd', 'claude.ps1', 'claude']) {
      expect(classifyClaudeInstall({ path: `${WIN_NPM}\\${name}`, shim: name === 'claude' ? SH_SHIM : WIN_SHIM })).toEqual({
        kind: 'npm',
        npmPrefix: WIN_NPM,
        legacyLocal: false
      })
    }
  })

  it('reads the prefix from a symlink target on macOS and Linux', () => {
    const real = '/home/dev/.npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
    expect(classifyClaudeInstall({ path: '/home/dev/.npm-global/bin/claude', realPath: real })).toEqual({
      kind: 'npm',
      npmPrefix: '/home/dev/.npm-global',
      legacyLocal: false
    })
  })

  it('keeps the native launcher native even though it is a symlink', () => {
    expect(
      classifyClaudeInstall({ path: '/home/dev/.local/bin/claude', realPath: '/home/dev/.local/share/claude/versions/2.1.310' }).kind
    ).toBe('native')
    expect(classifyClaudeInstall({ path: 'C:\\Users\\dev\\.local\\bin\\claude.exe' }).kind).toBe('native')
  })

  it('treats the old ~/.claude/local install as npm that only claude update can migrate', () => {
    expect(
      classifyClaudeInstall({
        path: '/home/dev/.claude/local/node_modules/.bin/claude',
        realPath: '/home/dev/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js'
      })
    ).toEqual({ kind: 'npm', npmPrefix: null, legacyLocal: true })
  })

  it('treats version-manager shims and unknown .cmd files as npm', () => {
    expect(classifyClaudeInstall({ path: 'C:\\Users\\dev\\AppData\\Local\\Volta\\bin\\claude.exe' }).kind).toBe('npm')
    expect(classifyClaudeInstall({ path: '/home/dev/.asdf/shims/claude' }).kind).toBe('npm')
    expect(classifyClaudeInstall({ path: 'D:\\tools\\claude.cmd' }).kind).toBe('npm')
  })
})

describe('commands for an existing Claude', () => {
  it('updates an npm install with npm and never the native installer', () => {
    const tool = claude({ installs: [install({ path: `${WIN_NPM}\\claude.cmd`, kind: 'npm', npmPrefix: WIN_NPM })], defaultNpmPrefix: WIN_NPM })
    expect(toolCommand(tool)).toEqual({ action: 'update', text: 'npm install -g @anthropic-ai/claude-code@latest', needsNode: true })
  })

  it('aims npm at the prefix that owns the install when it is not the default one', () => {
    expect(npmInstallCommand('@anthropic-ai/claude-code', 'D:\\nvm\\v22', WIN_NPM)).toBe(
      'npm install -g --prefix "D:\\nvm\\v22" @anthropic-ai/claude-code@latest'
    )
    expect(npmInstallCommand('p', 'C:\\N\\', 'c:\\n')).toBe('npm install -g p@latest')
    expect(npmInstallCommand('p', 'C:\\x', null)).toBe('npm install -g p@latest')
  })

  it('updates a native install and a legacy local install with claude update', () => {
    expect(toolCommand(claude({ installKind: 'native', installs: [install({})] })).text).toBe('claude update')
    expect(toolCommand(claude({ installs: [install({ kind: 'npm', legacyLocal: true, path: '/h/.claude/local/claude' })] })).text).toBe(
      'claude update'
    )
  })

  it('only offers the native installer when nothing is installed, with the right command per platform', () => {
    const none = claude({ present: false, installed: null, installKind: null, installs: [] })
    expect(toolCommand(none).text).toBe(CLAUDE_NATIVE_INSTALL)
    expect(toolCommand({ ...none, platform: 'darwin' }).text).toBe(CLAUDE_NATIVE_INSTALL_UNIX)
    expect(toolCommand({ ...none, platform: 'linux' }).text).toBe(CLAUDE_NATIVE_INSTALL_UNIX)
  })
})

describe('two installs', () => {
  const npm = install({ path: `${WIN_NPM}\\claude.cmd`, kind: 'npm', npmPrefix: WIN_NPM, version: '2.1.289' })
  const native = install({})

  it('names both paths, which one claude reaches and the docs fix', () => {
    const notice = claudeConflict([native, npm])
    expect(notice?.lines[0]).toBe(`Typing claude runs: ${native.path}`)
    expect(notice?.lines.join('\n')).toContain(npm.path)
    expect(notice?.lines.join('\n')).toContain('2.1.289')
    expect(notice?.fix).toEqual([`npm uninstall -g --prefix "${WIN_NPM}" @anthropic-ai/claude-code`])
  })

  it('keeps the native install and removes the extra one, on any platform', () => {
    const unixNpm = install({ path: '/h/.npm-global/bin/claude', kind: 'npm', npmPrefix: '/h/.npm-global' })
    const unixNative = install({ path: '/h/.local/bin/claude' })
    expect(claudeConflict([unixNpm, unixNative])?.fix).toEqual(['npm uninstall -g --prefix "/h/.npm-global" @anthropic-ai/claude-code'])
    expect(claudeConflict([unixNative, install({ path: '/usr/bin/claude' })])?.fix).toEqual([
      'rm -f ~/.local/bin/claude',
      'rm -rf ~/.local/share/claude'
    ])
  })

  it('is not a conflict for one install', () => {
    expect(claudeConflict([native])).toBeNull()
    expect(claudeConflict(undefined)).toBeNull()
  })

  it('blocks every automatic action, including Update all', () => {
    const tool = claude({ installs: [native, npm] })
    expect(toolCommand(tool).blocked).toBeTruthy()
    expect(planFor([tool], ['claude'])).toBeNull()
    expect(planFor([tool], 'updates')).toBeNull()
  })
})
