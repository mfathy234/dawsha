import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkAgentTools, clearLatestCache } from '../../src/main/agentTools'
import { toolCommand, toolState } from '../../src/shared/agentTools'
import { createFakeTools } from '../support/fakeTools'

const KEYS = [
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'npm_config_prefix',
  'DAWSHA_CLAUDE_COMMAND',
  'DAWSHA_CODEX_COMMAND',
  'DAWSHA_GEMINI_COMMAND'
]
let saved: Record<string, string | undefined> = {}
const dirs: string[] = []

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
  clearLatestCache()
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function fake(installed: Parameters<typeof createFakeTools>[1]) {
  const dir = mkdtempSync(join(tmpdir(), 'dawsha-tools-'))
  dirs.push(dir)
  const tools = createFakeTools(dir, installed, { claude: '2.1.301', codex: '0.156.1', gemini: '0.9.1' })
  process.env.PATH = `${tools.pathEntry}${delimiter}${process.env.PATH ?? ''}`
  process.env.DAWSHA_CLAUDE_COMMAND = tools.commands.claude
  process.env.DAWSHA_CODEX_COMMAND = tools.commands.codex
  process.env.DAWSHA_GEMINI_COMMAND = tools.commands.gemini
  return tools
}

describe('checkAgentTools with fake commands', () => {
  it('reads installed and latest versions and derives each state', async () => {
    fake({ claude: '2.1.294', codex: '0.156.1', gemini: null })
    const report = await checkAgentTools(true)
    const by = Object.fromEntries(report.tools.map((t) => [t.agent, t]))
    expect(by.claude).toMatchObject({ present: true, installed: '2.1.294', latest: '2.1.301', installKind: 'npm' })
    expect(by.codex).toMatchObject({ present: true, installed: '0.156.1', latest: '0.156.1' })
    expect(by.gemini).toMatchObject({ present: false, installed: null, latest: '0.9.1', installKind: null })
    expect(report.tools.map(toolState)).toEqual(['update', 'current', 'missing'])
    expect(report.node).toEqual({ node: '24.1.0', npm: '10.2.0' })
  })

  it('caches the latest lookup until forced', async () => {
    const tools = fake({ claude: '2.1.301', codex: '0.156.1', gemini: '0.9.1' })
    expect((await checkAgentTools(true)).tools[2].latest).toBe('0.9.1')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(tools.dir, 'latest', 'gemini.txt'), '0.9.2\r\n')
    expect((await checkAgentTools(false)).tools[2].latest).toBe('0.9.1')
    expect((await checkAgentTools(true)).tools[2].latest).toBe('0.9.2')
  })
})

describe.runIf(process.platform === 'win32')('checkAgentTools finds Claude outside the PATH it was started with', () => {
  const shim = [
    '@ECHO off',
    'REM "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"',
    'echo 2.1.289 (Claude Code)',
    ''
  ].join('\r\n')

  function isolate(): string {
    fake({ claude: null, codex: '0.156.1', gemini: '0.9.1' })
    delete process.env.DAWSHA_CLAUDE_COMMAND
    const home = mkdtempSync(join(tmpdir(), 'dawsha-home-'))
    dirs.push(home)
    process.env.PATH = (process.env.PATH ?? '').split(delimiter)[0]
    process.env.USERPROFILE = home
    process.env.APPDATA = join(home, 'AppData', 'Roaming')
    process.env.LOCALAPPDATA = join(home, 'AppData', 'Local')
    delete process.env.npm_config_prefix
    return home
  }

  function npmPrefix(prefix: string): void {
    const bin = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'claude.exe'), 'MZ')
    writeFileSync(join(prefix, 'claude.cmd'), shim)
    writeFileSync(join(prefix, 'claude'), '#!/bin/sh\nexec "$basedir/node_modules/@anthropic-ai/claude-code/bin/claude.exe" "$@"\n')
  }

  it('reports an npm install in the APPDATA npm folder as present and updates it with npm', async () => {
    const home = isolate()
    npmPrefix(join(home, 'AppData', 'Roaming', 'npm'))
    const claude = (await checkAgentTools(true)).tools[0]
    expect(claude).toMatchObject({ present: true, installKind: 'npm', installed: '2.1.289' })
    expect(claude.installs).toHaveLength(1)
    expect(toolCommand(claude).text).toBe('npm install -g @anthropic-ai/claude-code@latest')
  })

  it('finds an npm install under a custom prefix that npm_config_prefix names', async () => {
    const home = isolate()
    const prefix = join(home, 'custom-prefix')
    npmPrefix(prefix)
    process.env.npm_config_prefix = prefix
    const claude = (await checkAgentTools(true)).tools[0]
    expect(claude).toMatchObject({ present: true, installKind: 'npm' })
    expect(toolCommand(claude).text).not.toContain('install.ps1')
  })

  it('reports both installs and blocks every command when native and npm coexist', async () => {
    const home = isolate()
    npmPrefix(join(home, 'AppData', 'Roaming', 'npm'))
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    writeFileSync(join(home, '.local', 'bin', 'claude.exe'), 'MZ')
    const claude = (await checkAgentTools(true)).tools[0]
    expect(claude.installs?.map((i) => i.kind).sort()).toEqual(['native', 'npm'])
    expect(toolCommand(claude).blocked).toBeTruthy()
  })

  it('only offers the native installer when no Claude exists anywhere', async () => {
    isolate()
    const claude = (await checkAgentTools(true)).tools[0]
    expect(claude).toMatchObject({ present: false, installs: [] })
    expect(toolCommand(claude).text).toContain('install.ps1')
  })
})
