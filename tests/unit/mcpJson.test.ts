import { describe, expect, it } from 'vitest'
import { claudeServers, geminiServers, setClaudeLocalEnabled } from '../../src/shared/mcpJson'
import { MASK, publicServer } from '../../src/shared/mcp'

const CLAUDE =
  JSON.stringify(
    {
      numStartups: 3,
      mcpServers: {
        memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: { API_KEY: 'sk-live-abcdefghijklmnopqrstuv', REGION: 'eu' } }
      },
      projects: {
        'C:/code/app': {
          allowedTools: [],
          mcpServers: {
            api: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } },
            db: { command: 'db-mcp' }
          },
          disabledMcpServers: ['db']
        },
        'C:/code/other': { mcpServers: { x: { command: 'x' } } }
      }
    },
    null,
    2
  ) + '\n'
const PROJECTS = [{ name: 'App', folder: 'C:\\code\\app\\' }]
const MCP_JSON = JSON.stringify({ mcpServers: { shared: { type: 'sse', url: 'https://s.example.com/sse' } } })
const withFile = (mcpJsonText: string | null) => PROJECTS.map((p) => ({ ...p, mcpJsonText }))

describe('claudeServers', () => {
  const servers = claudeServers({ file: '~/.claude.json', userText: CLAUDE, projects: withFile(MCP_JSON) })
  it('lists user, local and project-file servers with their scope', () => {
    expect(servers.map((s) => [s.name, s.scope, s.scopeLabel, s.enabled, s.toggle])).toEqual([
      ['memory', 'user', 'User', true, 'readonly'],
      ['api', 'project', 'App', true, 'file'],
      ['db', 'project', 'App', false, 'file'],
      ['shared', 'project', 'App (.mcp.json)', true, 'readonly']
    ])
  })
  it('only lists projects Dawsha knows', () => {
    expect(servers.some((s) => s.name === 'x')).toBe(false)
  })
  it('reads stdio and url transports', () => {
    expect(servers[0].transport).toEqual({ kind: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] })
    expect(servers[1].transport).toEqual({ kind: 'url', url: 'https://example.com/mcp', type: 'http' })
  })
  it('has unique ids', () => {
    expect(new Set(servers.map((s) => s.id)).size).toBe(servers.length)
  })
  it('survives broken or empty files', () => {
    expect(claudeServers({ file: 'f', userText: '{nope', projects: [] })).toEqual([])
    expect(claudeServers({ file: 'f', userText: null, projects: withFile('[]') })).toEqual([])
  })
})

describe('publicServer masking', () => {
  const servers = claudeServers({ file: 'f', userText: CLAUDE, projects: withFile(null) })
  it('hides secret env and header values but not harmless ones', () => {
    expect(publicServer(servers[0]).entries).toEqual([
      { key: 'API_KEY', group: 'env', value: null, masked: true },
      { key: 'REGION', group: 'env', value: 'eu', masked: false }
    ])
    expect(publicServer(servers[1]).entries).toEqual([{ key: 'Authorization', group: 'headers', value: null, masked: true }])
  })
  it('masks secrets in the raw JSON too', () => {
    const raw = publicServer(servers[0]).raw
    expect(raw).not.toContain('sk-live')
    expect(raw).toContain(MASK)
    expect(raw).toContain('"REGION": "eu"')
    expect(publicServer(servers[1]).raw).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })
  it('masks secrets in args and URLs', () => {
    const s = claudeServers({
      file: 'f',
      userText: JSON.stringify({
        mcpServers: {
          a: { command: 'x', args: ['--api-key=hunter2hunter2', '--token', 'abc123', 'ok'] },
          b: { type: 'http', url: 'https://u:pw@h.example.com/m?access_token=zzz999&q=1' }
        }
      }),
      projects: []
    })
    const a = publicServer(s[0])
    expect(a.transport).toEqual({ kind: 'stdio', command: 'x', args: [`--api-key=${MASK}`, '--token', MASK, 'ok'] })
    expect(a.raw).not.toContain('hunter2')
    expect(a.raw).not.toContain('abc123')
    const b = publicServer(s[1])
    expect(JSON.stringify(b)).not.toMatch(/pw@|zzz999/)
    expect(b.transport).toMatchObject({ kind: 'url' })
  })
})

describe('geminiServers', () => {
  it('reads mcpServers, supports comments and trailing commas, and is read-only', () => {
    const text =
      '{\n // keep\n "theme": "x",\n "mcpServers": { "fs": { "command": "fs-mcp", "args": ["/"], }, "web": { "httpUrl": "https://w.example.com/mcp", "headers": {"X-Api-Key": "abcdefghijklmnop"} } }\n}'
    const servers = geminiServers('~/.gemini/settings.json', text)
    expect(servers.map((s) => [s.name, s.scope, s.toggle, s.agent])).toEqual([
      ['fs', 'user', 'readonly', 'gemini'],
      ['web', 'user', 'readonly', 'gemini']
    ])
    expect(servers[1].transport).toEqual({ kind: 'url', url: 'https://w.example.com/mcp', type: 'http' })
  })
})

describe('setClaudeLocalEnabled', () => {
  const folder = 'C:\\code\\app'
  it('adds and removes a name in the project disabledMcpServers list and changes nothing else', () => {
    const off = setClaudeLocalEnabled(CLAUDE, folder, 'api', false) as string
    const parsed = JSON.parse(off)
    expect(parsed.projects['C:/code/app'].disabledMcpServers).toEqual(['db', 'api'])
    expect(parsed.mcpServers).toEqual(JSON.parse(CLAUDE).mcpServers)
    expect(off.endsWith('\n')).toBe(true)
    expect(off).toContain('\n  "numStartups": 3,')
    expect(setClaudeLocalEnabled(off, folder, 'api', true)).toBe(CLAUDE)
  })
  it('creates the list when missing and removes it when it empties', () => {
    const text = JSON.stringify({ projects: { '/p': { mcpServers: { a: { command: 'a' } } } } })
    const off = JSON.parse(setClaudeLocalEnabled(text, '/p', 'a', false) as string)
    expect(off.projects['/p'].disabledMcpServers).toEqual(['a'])
    const back = JSON.parse(setClaudeLocalEnabled(JSON.stringify(off), '/p', 'a', true) as string)
    expect(back.projects['/p']).toEqual({ mcpServers: { a: { command: 'a' } } })
  })
  it('does nothing for an unknown server or project, and never throws on bad JSON', () => {
    expect(setClaudeLocalEnabled(CLAUDE, folder, 'zzz', false)).toBeNull()
    expect(setClaudeLocalEnabled(CLAUDE, 'C:\\other', 'api', false)).toBeNull()
    expect(setClaudeLocalEnabled('{bad', folder, 'api', false)).toBeNull()
  })
  it('returns the same text when already in that state', () => {
    expect(setClaudeLocalEnabled(CLAUDE, folder, 'api', true)).toBe(CLAUDE)
  })
})
