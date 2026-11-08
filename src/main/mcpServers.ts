import { homedir } from 'node:os'
import { join } from 'node:path'
import { listCodexServers, setCodexEnabled } from '../shared/mcpCodex'
import { claudeServers, geminiServers, normalPath, setClaudeLocalEnabled } from '../shared/mcpJson'
import type { McpServerFull } from '../shared/mcp'
import { readSnapshot, readText, saveAtomically } from './mcpFiles'

export interface McpPaths {
  claudeJson: string
  codexToml: string
  geminiJson: string
}

export interface McpProject {
  name: string
  folder: string
}

type Outcome = { ok: true } | { ok: false; error: string }

/** The three user-level files Dawsha reads. Nothing else is ever written. */
export function mcpPaths(env: NodeJS.ProcessEnv = process.env, home: string = env.USERPROFILE ?? homedir()): McpPaths {
  return {
    claudeJson: join(env.DAWSHA_CLAUDE_HOME ?? env.CLAUDE_CONFIG_DIR ?? home, '.claude.json'),
    codexToml: join(env.DAWSHA_CODEX_HOME ?? join(home, '.codex'), 'config.toml'),
    geminiJson: join(env.DAWSHA_GEMINI_HOME ?? join(home, '.gemini'), 'settings.json')
  }
}

/** Every server of every agent, with real values. Keep this in the main process. */
export async function listMcpServers(paths: McpPaths, projects: readonly McpProject[]): Promise<McpServerFull[]> {
  const [claudeText, codexText, geminiText] = await Promise.all([readText(paths.claudeJson), readText(paths.codexToml), readText(paths.geminiJson)])
  const withFiles = await Promise.all(projects.map(async (project) => ({ ...project, mcpJsonText: await readText(join(project.folder, '.mcp.json')) })))
  return [
    ...claudeServers({ file: paths.claudeJson, userText: claudeText, projects: withFiles }),
    ...(codexText === null ? [] : listCodexServers(codexText, paths.codexToml)),
    ...geminiServers(paths.geminiJson, geminiText)
  ]
}

async function editFile(path: string, edit: (text: string) => string | null): Promise<Outcome> {
  const before = await readSnapshot(path)
  if (!before) return { ok: false, error: 'The file could not be read.' }
  const next = edit(before.text)
  if (next === null) return { ok: false, error: 'That server is no longer in the file.' }
  return next === before.text ? { ok: true } : saveAtomically(path, next, before)
}

function projectFolder(server: McpServerFull, projects: readonly McpProject[]): string | null {
  return projects.find((project) => server.id.startsWith(`claude:local:${normalPath(project.folder)}:`))?.folder ?? null
}

/** Switches one server on or off in its own file, changing only that entry. */
export async function toggleMcpServer(paths: McpPaths, projects: readonly McpProject[], id: string, enabled: boolean): Promise<Outcome> {
  const server = (await listMcpServers(paths, projects)).find((item) => item.id === id)
  if (!server) return { ok: false, error: 'That server is no longer listed.' }
  if (server.toggle !== 'file') return { ok: false, error: 'Dawsha cannot switch this server. Edit the file instead.' }
  if (server.agent === 'codex') return editFile(paths.codexToml, (text) => setCodexEnabled(text, server.name, enabled))
  const folder = projectFolder(server, projects)
  if (server.agent !== 'claude' || !folder) return { ok: false, error: 'Dawsha cannot switch this server. Edit the file instead.' }
  return editFile(paths.claudeJson, (text) => setClaudeLocalEnabled(text, folder, server.name, enabled))
}

/** One env or header value, read again from the file when the user clicks its mask. */
export async function revealMcpValue(paths: McpPaths, projects: readonly McpProject[], id: string, key: string, group: string): Promise<string | null> {
  const server = (await listMcpServers(paths, projects)).find((item) => item.id === id)
  return server?.entries.find((entry) => entry.key === key && entry.group === group)?.value ?? null
}

/** The file a listed server lives in, for the Open file button. */
export async function mcpServerFile(paths: McpPaths, projects: readonly McpProject[], id: string): Promise<string | null> {
  return (await listMcpServers(paths, projects)).find((item) => item.id === id)?.file ?? null
}
