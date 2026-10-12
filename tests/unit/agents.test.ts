import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentLabel, agentOf, nextAgent, sessionLabel } from '../../src/shared/agents'
import { agentArgs, claudeCommand, launchSpec, locateCodexBinary, locateGeminiEntry, shellArgs, shellCommand } from '../../src/main/agentLaunch'
import type { SpawnRequest } from '../../src/shared/types'

const request = (patch: Partial<SpawnRequest>): SpawnRequest => ({
  id: 't',
  agent: 'codex',
  cwd: process.cwd(),
  resume: false,
  cols: 80,
  rows: 24,
  ...patch
})

describe('agent helpers', () => {
  it('resolves a project default and falls back to claude', () => {
    expect(agentOf({ defaultAgent: 'codex' })).toBe('codex')
    expect(agentOf({ defaultAgent: 'claude' })).toBe('claude')
    expect(agentOf(undefined)).toBe('claude')
    expect(agentOf({ defaultAgent: 'gemini' })).toBe('gemini')
    expect(nextAgent('claude')).toBe('codex')
    expect(nextAgent('codex')).toBe('gemini')
    expect(nextAgent('gemini')).toBe('claude')
  })

  it('labels agents', () => {
    expect(agentLabel('claude')).toBe('Claude Code')
    expect(sessionLabel('codex')).toBe('Codex session')
    expect(sessionLabel('gemini')).toBe('Gemini session')
    expect(agentLabel('gemini')).toBe('Gemini')
    expect(sessionLabel('shell')).toBe('Shell')
  })
})

describe('agentArgs', () => {
  it('claude continues, codex resumes a specific session id, never a bare resume', () => {
    expect(agentArgs({ agent: 'claude', resume: true }, false)).toEqual(['--continue'])
    expect(agentArgs({ agent: 'codex', resume: true, sessionId: 'abc' }, false)).toEqual(['resume', 'abc'])
    expect(agentArgs({ agent: 'codex', resume: true }, false)).toEqual([])
    expect(agentArgs({ agent: 'claude', resume: true, sessionId: 'abc' }, false)).toEqual(['-r', 'abc'])
    expect(agentArgs({ agent: 'codex', resume: false, sessionId: 'abc' }, false)).toEqual([])
  })

  it('adds the full-access flag of each agent only when asked, after a codex resume subcommand', () => {
    expect(agentArgs({ agent: 'claude', resume: false, fullAccess: true }, false)).toEqual(['--dangerously-skip-permissions'])
    expect(agentArgs({ agent: 'claude', resume: true, sessionId: 'abc', fullAccess: true }, false)).toEqual([
      '--dangerously-skip-permissions',
      '-r',
      'abc'
    ])
    expect(agentArgs({ agent: 'codex', resume: false, fullAccess: true }, false)).toEqual([
      '--dangerously-bypass-approvals-and-sandbox'
    ])
    expect(agentArgs({ agent: 'codex', resume: true, sessionId: 'abc', fullAccess: true }, false)).toEqual([
      'resume',
      'abc',
      '--dangerously-bypass-approvals-and-sandbox'
    ])
    expect(agentArgs({ agent: 'gemini', resume: false, sessionId: 'u-1', fullAccess: true }, false)).toEqual([
      '--yolo',
      '--session-id',
      'u-1'
    ])
    expect(agentArgs({ agent: 'codex', resume: false, fullAccess: false }, false)).toEqual([])
    expect(agentArgs({ agent: 'shell', resume: false, fullAccess: true }, false)).toEqual([])
    expect(agentArgs({ agent: 'claude', resume: false, fullAccess: true }, true)).toEqual([])
  })

  it('gemini starts with a chosen session id and resumes exactly that id, never latest', () => {
    expect(agentArgs({ agent: 'gemini', resume: false, sessionId: 'u-1' }, false)).toEqual(['--session-id', 'u-1'])
    expect(agentArgs({ agent: 'gemini', resume: true, sessionId: 'u-1' }, false)).toEqual(['--resume', 'u-1'])
    expect(agentArgs({ agent: 'gemini', resume: true }, false)).toEqual([])
    expect(agentArgs({ agent: 'gemini', resume: false, sessionId: 'u-1' }, true)).toEqual([])
  })

  it('adds nothing when the command is overridden', () => {
    expect(agentArgs({ agent: 'claude', resume: true }, true)).toEqual([])
    expect(agentArgs({ agent: 'codex', resume: true, sessionId: 'abc' }, true)).toEqual([])
  })
})

describe('locateCodexBinary', () => {
  const root = mkdtempSync(join(tmpdir(), 'cg-npm-'))
  const vendor = ['@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin']

  it('finds the native binary under the npm package next to codex.cmd', () => {
    const dir = join(root, 'nested')
    const bin = join(dir, 'node_modules', '@openai', 'codex', 'node_modules', ...vendor)
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(dir, 'codex.cmd'), '', 'utf8')
    writeFileSync(join(bin, 'codex.exe'), '', 'utf8')
    expect(locateCodexBinary(['C:\\nowhere', dir])).toBe(join(bin, 'codex.exe'))
  })

  it('finds a hoisted layout and returns null when nothing matches', () => {
    const dir = join(root, 'hoisted')
    const bin = join(dir, 'node_modules', ...vendor)
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(dir, 'codex.cmd'), '', 'utf8')
    writeFileSync(join(bin, 'codex.exe'), '', 'utf8')
    expect(locateCodexBinary([dir])).toBe(join(bin, 'codex.exe'))
    expect(locateCodexBinary([join(root, 'empty')])).toBeNull()
  })
})

describe('locateGeminiEntry', () => {
  const root = mkdtempSync(join(tmpdir(), 'cg-gemini-'))

  it('runs the bundled entry with node.exe next to gemini.cmd, else node from PATH', () => {
    const dir = join(root, 'npm')
    const bundle = join(dir, 'node_modules', '@google', 'gemini-cli', 'bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(dir, 'gemini.cmd'), '', 'utf8')
    writeFileSync(join(bundle, 'gemini.js'), '', 'utf8')
    writeFileSync(join(dir, 'node.exe'), '', 'utf8')
    expect(locateGeminiEntry(['C:\\nowhere', dir])).toEqual({
      file: join(dir, 'node.exe'),
      args: [join(bundle, 'gemini.js')]
    })
    expect(locateGeminiEntry([join(root, 'empty')])).toBeNull()
  })
})

describe('launchSpec', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('uses DAWSHA_CODEX_COMMAND for codex without resume args', () => {
    process.env.DAWSHA_CODEX_COMMAND = process.execPath
    const spec = launchSpec(request({ resume: true, sessionId: 'abc' }))
    expect(spec).toEqual({ file: process.execPath, args: [] })
  })

  it('keeps the claude and codex overrides independent', () => {
    process.env.DAWSHA_CLAUDE_COMMAND = process.execPath
    process.env.DAWSHA_CODEX_COMMAND = 'C:\\definitely\\missing\\codex.exe'
    expect(launchSpec(request({ agent: 'claude', resume: true }))).toEqual({ file: process.execPath, args: [] })
    expect(launchSpec(request({ agent: 'codex' }))).toContain('Could not find')
  })

  it('uses DAWSHA_GEMINI_COMMAND for gemini without session args and reports a missing one', () => {
    process.env.DAWSHA_GEMINI_COMMAND = process.execPath
    expect(launchSpec(request({ agent: 'gemini', sessionId: 'u-1' }))).toEqual({ file: process.execPath, args: [] })
    process.env.DAWSHA_GEMINI_COMMAND = 'C:\\definitely\\missing\\gemini.exe'
    expect(launchSpec(request({ agent: 'gemini' }))).toContain('Could not find')
  })

  it('appends the initial prompt after the agent arguments, even for overridden commands', () => {
    process.env.DAWSHA_CLAUDE_COMMAND = process.execPath
    process.env.DAWSHA_CODEX_COMMAND = process.execPath
    process.env.DAWSHA_GEMINI_COMMAND = process.execPath
    process.env.DAWSHA_CODEX_ARGS = '["--flag"]'
    const prompt = 'Why does the "login" test fail?\nSecond line'
    expect(launchSpec(request({ agent: 'claude', prompt }))).toEqual({ file: process.execPath, args: [prompt] })
    expect(launchSpec(request({ agent: 'codex', prompt }))).toEqual({ file: process.execPath, args: ['--flag', prompt] })
    expect(launchSpec(request({ agent: 'gemini', sessionId: 'u-1', prompt }))).toEqual({
      file: process.execPath,
      args: [`--prompt-interactive=${prompt}`]
    })
  })

  it('adds the prompt after the session id Gemini gets by default and never to a shell tab', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-gemini-prompt-'))
    const bundle = join(dir, 'node_modules', '@google', 'gemini-cli', 'bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(dir, 'gemini.cmd'), '', 'utf8')
    writeFileSync(join(bundle, 'gemini.js'), '', 'utf8')
    writeFileSync(join(dir, 'node.exe'), '', 'utf8')
    delete process.env.DAWSHA_GEMINI_COMMAND
    process.env.PATH = dir
    expect(launchSpec(request({ agent: 'gemini', sessionId: 'u-1', prompt: 'hi there' }), 'win32')).toEqual({
      file: join(dir, 'node.exe'),
      args: [join(bundle, 'gemini.js'), '--session-id', 'u-1', '--prompt-interactive=hi there']
    })
    process.env.DAWSHA_SHELL = process.execPath
    expect(launchSpec(request({ agent: 'shell', prompt: 'ignored' }), 'win32')).toEqual({ file: process.execPath, args: [] })
  })

  it('refuses a prompt for an agent that can only be started through a .cmd shim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-codex-shim-'))
    writeFileSync(join(dir, 'codex.cmd'), '', 'utf8')
    delete process.env.DAWSHA_CODEX_COMMAND
    process.env.PATH = dir
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
    expect(launchSpec(request({ agent: 'codex', prompt: 'a & b' }), 'win32')).toContain('.cmd shim')
    expect(typeof launchSpec(request({ agent: 'codex' }), 'win32')).toBe('object')
  })

  it('splits DAWSHA_CODEX_ARGS', () => {
    process.env.DAWSHA_CODEX_COMMAND = process.execPath
    process.env.DAWSHA_CODEX_ARGS = '["--flag","two words"]'
    expect(launchSpec(request({}))).toEqual({ file: process.execPath, args: ['--flag', 'two words'] })
  })

  it('uses macOS executable names and finds extensionless Codex and Gemini commands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawsha-macos-tools-'))
    writeFileSync(join(dir, 'codex'), '', 'utf8')
    writeFileSync(join(dir, 'gemini'), '', 'utf8')
    delete process.env.DAWSHA_CODEX_COMMAND
    delete process.env.DAWSHA_GEMINI_COMMAND
    process.env.PATH = dir

    expect(claudeCommand('darwin')).toBe('claude')
    expect(launchSpec(request({ agent: 'codex' }), 'darwin')).toEqual({ file: join(dir, 'codex'), args: [] })
    expect(launchSpec(request({ agent: 'gemini' }), 'darwin')).toEqual({ file: join(dir, 'gemini'), args: [] })
  })
})

describe('shellArgs', () => {
  it('opens a plain interactive shell without a command', () => {
    delete process.env.DAWSHA_SHELL
    expect(shellArgs('pwsh.exe', undefined, 'win32')).toEqual(['-NoLogo'])
  })

  it('runs a one-shot command with the right switches per shell', () => {
    expect(shellArgs('pwsh.exe', 'npm -v', 'win32')).toEqual(['-NoLogo', '-Command', 'npm -v'])
    expect(shellArgs('cmd.exe', 'npm -v')).toEqual(['/d', '/s', '/c', 'npm -v'])
    expect(shellArgs(['C:', 'Windows', 'System32', 'cmd.exe'].join(String.fromCharCode(92)), 'npm -v')[0]).toBe('/d')
  })

  it('selects zsh and login-shell arguments on macOS', () => {
    delete process.env.DAWSHA_SHELL
    expect(shellCommand('darwin', { SHELL: '/bin/zsh' })).toBe('/bin/zsh')
    expect(shellArgs('/bin/zsh', undefined, 'darwin')).toEqual(['-l'])
    expect(shellArgs('/bin/zsh', 'npm -v', 'darwin')).toEqual(['-lc', 'npm -v'])
  })
})
