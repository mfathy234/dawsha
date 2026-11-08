import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listMcpServers, mcpPaths, revealMcpValue, toggleMcpServer, type McpPaths } from '../../src/main/mcpServers'
import { saveAtomically, readSnapshot } from '../../src/main/mcpFiles'

let home = ''
let paths: McpPaths
let app = ''
const projects = () => [{ name: 'App', folder: app }]

const claudeText = (folder: string) =>
  JSON.stringify({ projects: { [folder.replace(/\\/g, '/')]: { mcpServers: { api: { command: 'api' } } } }, mcpServers: { mem: { command: 'mem', env: { TOKEN: 'secret-token-value-123456' } } } }, null, 2) + '\n'
const CODEX = '[mcp_servers.docs]\ncommand = "docs"\n\n[mcp_servers.docs.env]\nAPI_KEY = "abcdefghijklmnopqrstuvwxyz0123456789"\n'

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dawsha-mcp-'))
  app = join(home, 'app')
  await mkdir(app)
  await mkdir(join(home, '.codex'))
  paths = mcpPaths({ DAWSHA_CODEX_HOME: join(home, '.codex'), DAWSHA_GEMINI_HOME: join(home, '.gemini') } as NodeJS.ProcessEnv, home)
  await writeFile(paths.claudeJson, claudeText(app))
  await writeFile(paths.codexToml, CODEX)
  await writeFile(join(app, '.mcp.json'), JSON.stringify({ mcpServers: { shared: { command: 'shared' } } }))
})
afterEach(() => rm(home, { recursive: true, force: true }))

describe('mcpPaths', () => {
  it('uses the home folder and honours the config overrides', () => {
    const p = mcpPaths({} as NodeJS.ProcessEnv, '/h')
    expect(p.claudeJson.replace(/\\/g, '/')).toBe('/h/.claude.json')
    expect(p.codexToml.replace(/\\/g, '/')).toBe('/h/.codex/config.toml')
    expect(p.geminiJson.replace(/\\/g, '/')).toBe('/h/.gemini/settings.json')
    expect(mcpPaths({ CLAUDE_CONFIG_DIR: '/c' } as NodeJS.ProcessEnv, '/h').claudeJson.replace(/\\/g, '/')).toBe('/c/.claude.json')
  })
})

describe('listMcpServers', () => {
  it('lists servers of every agent and tolerates missing files', async () => {
    const servers = await listMcpServers(paths, projects())
    expect(servers.map((s) => `${s.agent}/${s.scopeLabel}/${s.name}`)).toEqual(['claude/User/mem', 'claude/App/api', 'claude/App (.mcp.json)/shared', 'codex/User/docs'])
  })
})

describe('toggleMcpServer', () => {
  it('switches a Codex server off, backs up the old file, and leaves no temp file', async () => {
    const result = await toggleMcpServer(paths, projects(), 'codex:user:docs', false)
    expect(result).toEqual({ ok: true })
    expect(await readFile(paths.codexToml, 'utf8')).toBe(CODEX.replace('[mcp_servers.docs]\n', '[mcp_servers.docs]\nenabled = false\n'))
    expect(await readFile(`${paths.codexToml}.dawsha-bak`, 'utf8')).toBe(CODEX)
    expect((await readdir(join(home, '.codex'))).sort()).toEqual(['config.toml', 'config.toml.dawsha-bak'])
    expect((await listMcpServers(paths, projects())).find((s) => s.id === 'codex:user:docs')?.enabled).toBe(false)
  })

  it('switches a Claude local-scope server through disabledMcpServers', async () => {
    const id = (await listMcpServers(paths, projects())).find((s) => s.name === 'api')?.id as string
    expect(await toggleMcpServer(paths, projects(), id, false)).toEqual({ ok: true })
    const parsed = JSON.parse(await readFile(paths.claudeJson, 'utf8'))
    expect(Object.values(parsed.projects as Record<string, { disabledMcpServers: string[] }>)[0].disabledMcpServers).toEqual(['api'])
    expect(await toggleMcpServer(paths, projects(), id, true)).toEqual({ ok: true })
    expect(await readFile(paths.claudeJson, 'utf8')).toBe(claudeText(app))
  })

  it('refuses read-only servers and unknown ids without touching any file', async () => {
    const before = await readFile(paths.claudeJson, 'utf8')
    expect((await toggleMcpServer(paths, projects(), 'claude:user:mem', false)).ok).toBe(false)
    expect((await toggleMcpServer(paths, projects(), '../../etc/passwd', false)).ok).toBe(false)
    expect(await readFile(paths.claudeJson, 'utf8')).toBe(before)
  })
})

describe('revealMcpValue', () => {
  it('returns a secret only for a listed server and key', async () => {
    expect(await revealMcpValue(paths, projects(), 'codex:user:docs', 'API_KEY', 'env')).toBe('abcdefghijklmnopqrstuvwxyz0123456789')
    expect(await revealMcpValue(paths, projects(), 'codex:user:docs', 'NOPE', 'env')).toBeNull()
    expect(await revealMcpValue(paths, projects(), 'x', 'API_KEY', 'env')).toBeNull()
  })
})

describe('saveAtomically', () => {
  it('refuses to overwrite a file that changed since it was read', async () => {
    const before = await readSnapshot(paths.codexToml)
    await writeFile(paths.codexToml, 'changed = true\n')
    await utimes(paths.codexToml, new Date(), new Date(Date.now() + 5000))
    const result = await saveAtomically(paths.codexToml, 'mine = true\n', before as NonNullable<typeof before>)
    expect(result.ok).toBe(false)
    expect(await readFile(paths.codexToml, 'utf8')).toBe('changed = true\n')
    expect((await readdir(join(home, '.codex'))).sort()).toEqual(['config.toml'])
  })
})
