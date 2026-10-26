import { spawn } from 'node:child_process'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import { AGENTS } from '../shared/agents'
import { classifyClaudeInstall, type ClaudeInstall } from '../shared/claudeInstalls'
import {
  NPM_PACKAGES,
  parseNodeVersion,
  parseVersion,
  type AgentsReport,
  type ToolReport
} from '../shared/agentTools'
import type { AgentKind } from '../shared/types'
import { agentCommand } from './agentLaunch'
import { scanClaudeInstalls, splitPath } from './claudeInstalls'
import { claudeFallbackDirs, platformExecutableDirs, resolveExecutable } from './executables'
import { clearLoginShellPath, loginShellPath } from './loginShellPath'

export const LATEST_TTL_MS = 30 * 60 * 1000
const RUN_TIMEOUT_MS = 20_000
const FETCH_TIMEOUT_MS = 8000
const REGISTRY_URL = 'https://registry.npmjs.org'

interface CachedLatest {
  at: number
  version: string
}

const latestCache = new Map<string, CachedLatest>()

export const clearLatestCache = (): void => latestCache.clear()

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const extension = extname(file).toLowerCase()
    const viaShell = extension === '.cmd' || extension === '.bat'
    const command = viaShell ? (process.env.ComSpec ?? 'cmd.exe') : file
    const argv = viaShell ? ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`] : args
    let output = ''
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    let child: ReturnType<typeof spawn>
    try {
      const dirs = platformExecutableDirs()
      const env = dirs.length
        ? { ...process.env, PATH: [...new Set([...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...dirs])].join(delimiter) }
        : process.env
      child = spawn(command, argv, { env, windowsHide: true, windowsVerbatimArguments: viaShell, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, RUN_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.on('error', () => finish(null))
    child.on('close', () => finish(output))
  })
}

function locate(agent: AgentKind): string | null {
  return resolveExecutable(agentCommand(agent), platformExecutableDirs())
}

async function npmGlobalPrefix(): Promise<string | null> {
  const npm = resolveExecutable('npm', platformExecutableDirs())
  const output = npm ? await run(npm, ['prefix', '-g']) : null
  const line = (output ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => isAbsolute(entry))
    .pop()
  return line ?? null
}

const RUNNABLE = /\.(exe|cmd|bat)$/i

async function withVersion(install: ClaudeInstall): Promise<ClaudeInstall> {
  if (process.platform === 'win32' && !RUNNABLE.test(install.path)) return install
  const output = await run(install.path, ['--version'])
  return { ...install, version: output ? parseVersion('claude', output) : null }
}

/** Every Claude Code on this machine, found the way a terminal would find it plus the places a GUI app's PATH misses. */
async function findClaudeInstalls(prefix: string | null): Promise<ClaudeInstall[]> {
  const override = process.env.DAWSHA_CLAUDE_COMMAND
  if (override) {
    const file = resolveExecutable(override, platformExecutableDirs())
    return file ? [await withVersion({ path: file, ...classifyClaudeInstall({ path: file }), onPath: true, version: null })] : []
  }
  const loginDirs = await loginShellPath()
  const prefixBin = prefix ? [process.platform === 'win32' ? prefix : join(prefix, 'bin')] : []
  const installs = scanClaudeInstalls({
    pathDirs: [...splitPath(process.env.PATH), ...loginDirs],
    extraDirs: [...prefixBin, ...claudeFallbackDirs(), ...platformExecutableDirs()]
  })
  return Promise.all(installs.map(withVersion))
}

async function nodeInfo(): Promise<AgentsReport['node']> {
  const dirs = platformExecutableDirs()
  const nodePath = resolveExecutable('node', dirs)
  const npmPath = resolveExecutable('npm', dirs)
  const [node, npm] = await Promise.all([
    nodePath ? run(nodePath, ['--version']) : Promise.resolve(null),
    npmPath ? run(npmPath, ['--version']) : Promise.resolve(null)
  ])
  return { node: node ? parseNodeVersion(node) : null, npm: npm ? parseNodeVersion(npm) : null }
}

async function fromRegistry(pkg: string): Promise<string | null> {
  try {
    const response = await fetch(`${REGISTRY_URL}/${pkg.replace('/', '%2F')}/latest`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    const version = (body as { version?: unknown }).version
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

async function latestVersion(agent: AgentKind, force: boolean): Promise<string | null> {
  const pkg = NPM_PACKAGES[agent]
  const cached = latestCache.get(pkg)
  if (!force && cached && Date.now() - cached.at < LATEST_TTL_MS) return cached.version
  const npm = resolveExecutable('npm', platformExecutableDirs())
  let version: string | null = null
  if (npm) {
    const output = await run(npm, ['view', pkg, 'version'])
    version = output ? (/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(output)?.[1] ?? null) : null
  }
  if (version === null) version = await fromRegistry(pkg)
  if (version !== null) latestCache.set(pkg, { at: Date.now(), version })
  return version
}

async function inspectClaude(force: boolean, prefix: string | null): Promise<ToolReport> {
  const [installs, latest] = await Promise.all([findClaudeInstalls(prefix), latestVersion('claude', force)])
  const active = installs[0]
  return {
    agent: 'claude',
    present: installs.length > 0,
    installed: active?.version ?? null,
    latest,
    latestFailed: latest === null,
    installKind: active?.kind ?? null,
    installs,
    defaultNpmPrefix: prefix,
    platform: process.platform
  }
}

async function inspect(agent: AgentKind, force: boolean, prefix: string | null): Promise<ToolReport> {
  if (agent === 'claude') return inspectClaude(force, prefix)
  const path = locate(agent)
  const [output, latest] = await Promise.all([path ? run(path, ['--version']) : Promise.resolve(null), latestVersion(agent, force)])
  return {
    agent,
    present: path !== null,
    installed: output ? parseVersion(agent, output) : null,
    latest,
    latestFailed: latest === null,
    installKind: path ? 'npm' : null
  }
}

export async function checkAgentTools(force: boolean): Promise<AgentsReport> {
  if (force) clearLoginShellPath()
  const prefix = await npmGlobalPrefix()
  const [tools, node] = await Promise.all([Promise.all(AGENTS.map((agent) => inspect(agent, force, prefix))), nodeInfo()])
  return { tools, node, checkedAt: Date.now() }
}
