import { describe, expect, it } from 'vitest'
import { listCodexServers, setCodexEnabled } from '../../src/shared/mcpCodex'
import { parseToml } from '../../src/shared/mcpToml'

const FIXTURE = [
  '# Codex config',
  'model = "gpt-5"',
  '',
  '[mcp_servers.github]',
  'command = "npx"   # run it',
  'args = ["-y", "@modelcontextprotocol/server-github"]',
  '',
  '[mcp_servers.github.env]',
  'GITHUB_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123"',
  'LOG = "debug"',
  '',
  '[mcp_servers."my docs"]',
  'url = "https://example.com/mcp?token=abc123456789&x=1"',
  'enabled = false',
  '',
  '[mcp_servers.multi]',
  'command = "node"',
  'args = [',
  '  "server.js",   # first',
  '  "--port", "3000",',
  ']',
  'env = { A = "1", B = "two" }',
  '',
  '[projects."C:\\\\code\\\\x"]',
  'trust_level = "trusted"',
  ''
].join('\n')

describe('parseToml', () => {
  it('reads tables, strings, arrays, inline tables, comments and multi-line values', () => {
    const items = parseToml(FIXTURE)
    const kvs = items.flatMap((i) => (i.kind === 'kv' ? [i] : []))
    const tables = items.filter((i) => i.kind === 'table').map((i) => i.path.join('|'))
    expect(tables).toEqual(['mcp_servers|github', 'mcp_servers|github|env', 'mcp_servers|my docs', 'mcp_servers|multi', 'projects|C:\\code\\x'])
    const args = kvs.filter((i) => i.key === 'args').map((i) => i.value)
    expect(args[1]).toEqual(['server.js', '--port', '3000'])
    const env = kvs.find((i) => i.key === 'env')
    expect(env?.value).toEqual({ A: '1', B: 'two' })
  })

  it('handles literal strings, escapes and keeps going after a broken line', () => {
    const items = parseToml("a = 'C:\\x'\nb = \"q\\\"uote\\n\"\n@@@ nonsense\nc = true\nd = 12\n")
    const kv = Object.fromEntries(items.filter((i) => i.kind === 'kv').map((i) => [i.key, i.value]))
    expect(kv).toEqual({ a: 'C:\\x', b: 'q"uote\n', c: true, d: 12 })
  })
})

describe('listCodexServers', () => {
  const servers = listCodexServers(FIXTURE, '/home/u/.codex/config.toml')
  it('lists each server with transport, env, enabled and raw text', () => {
    expect(servers.map((s) => s.name)).toEqual(['github', 'my docs', 'multi'])
    expect(servers[0].transport).toEqual({ kind: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] })
    expect(servers[0].entries).toEqual([
      { key: 'GITHUB_TOKEN', value: 'ghp_abcdefghijklmnopqrstuvwxyz0123', group: 'env' },
      { key: 'LOG', value: 'debug', group: 'env' }
    ])
    expect(servers[0].enabled).toBe(true)
    expect(servers[0].toggle).toBe('file')
    expect(servers[1].transport).toMatchObject({ kind: 'url' })
    expect(servers[1].enabled).toBe(false)
    expect(servers[2].transport).toEqual({ kind: 'stdio', command: 'node', args: ['server.js', '--port', '3000'] })
    expect(servers[2].entries.map((e) => e.key)).toEqual(['A', 'B'])
    expect(JSON.parse(servers[0].rawText)).toEqual({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123', LOG: 'debug' } })
  })
  it('returns nothing for text without servers', () => {
    expect(listCodexServers('model = "x"\n', 'f')).toEqual([])
  })
})

describe('setCodexEnabled', () => {
  it('adds enabled = false right under the table header and leaves everything else alone', () => {
    const out = setCodexEnabled(FIXTURE, 'github', false) as string
    expect(out).toContain('[mcp_servers.github]\nenabled = false\ncommand = "npx"   # run it')
    expect(out.replace('[mcp_servers.github]\nenabled = false\n', '[mcp_servers.github]\n')).toBe(FIXTURE)
  })
  it('rewrites an existing enabled line and keeps its comment', () => {
    const text = '[mcp_servers.a]\nenabled = true # keep\ncommand = "x"\n'
    expect(setCodexEnabled(text, 'a', false)).toBe('[mcp_servers.a]\nenabled = false # keep\ncommand = "x"\n')
    expect(setCodexEnabled(FIXTURE, 'my docs', true)).toContain('enabled = true')
  })
  it('does not touch the env sub-table or a similarly named server', () => {
    const text = '[mcp_servers.a.env]\nenabled = "yes"\n[mcp_servers.a]\ncommand = "x"\n[mcp_servers.ab]\ncommand = "y"\n'
    expect(setCodexEnabled(text, 'a', false)).toBe('[mcp_servers.a.env]\nenabled = "yes"\n[mcp_servers.a]\nenabled = false\ncommand = "x"\n[mcp_servers.ab]\ncommand = "y"\n')
  })
  it('keeps CRLF line endings', () => {
    expect(setCodexEnabled('[mcp_servers.a]\r\ncommand = "x"\r\n', 'a', false)).toBe('[mcp_servers.a]\r\nenabled = false\r\ncommand = "x"\r\n')
  })
  it('returns null when the server is not in the file', () => {
    expect(setCodexEnabled(FIXTURE, 'nope', false)).toBeNull()
  })
})
