import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkAgentTools, clearLatestCache } from '../../src/main/agentTools'
import { toolState } from '../../src/shared/agentTools'
import { createFakeTools } from '../support/fakeTools'

const KEYS = ['PATH', 'DAWSHA_CLAUDE_COMMAND', 'DAWSHA_CODEX_COMMAND', 'DAWSHA_GEMINI_COMMAND']
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
