import { spawn } from 'node:child_process'
import { extname } from 'node:path'
import { AGENTS } from '../shared/agents'
import {
  NPM_PACKAGES,
  claudeInstallKind,
  parseNodeVersion,
  parseVersion,
  type AgentsReport,
  type ToolReport
} from '../shared/agentTools'
import type { AgentKind } from '../shared/types'
import { agentCommand } from './agentLaunch'
import { claudeFallbackDirs, resolveExecutable } from './executables'

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
      child = spawn(command, argv, { windowsHide: true, windowsVerbatimArguments: viaShell, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const command = agentCommand(agent)
  const found = resolveExecutable(command, agent === 'claude' ? claudeFallbackDirs() : [])
  if (found || agent !== 'claude' || process.env.DAWSHA_CLAUDE_COMMAND) return found
  return resolveExecutable('claude.cmd')
}

async function nodeInfo(): Promise<AgentsReport['node']> {
  const nodePath = resolveExecutable('node')
  const npmPath = resolveExecutable('npm')
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
  const npm = resolveExecutable('npm')
  let version: string | null = null
  if (npm) {
    const output = await run(npm, ['view', pkg, 'version'])
    version = output ? (/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(output)?.[1] ?? null) : null
  }
  if (version === null) version = await fromRegistry(pkg)
  if (version !== null) latestCache.set(pkg, { at: Date.now(), version })
  return version
}

async function inspect(agent: AgentKind, force: boolean): Promise<ToolReport> {
  const path = locate(agent)
  const [output, latest] = await Promise.all([path ? run(path, ['--version']) : Promise.resolve(null), latestVersion(agent, force)])
  return {
    agent,
    present: path !== null,
    installed: output ? parseVersion(agent, output) : null,
    latest,
    latestFailed: latest === null,
    installKind: agent === 'claude' ? claudeInstallKind(path) : path ? 'npm' : null
  }
}

export async function checkAgentTools(force: boolean): Promise<AgentsReport> {
  const [tools, node] = await Promise.all([Promise.all(AGENTS.map((agent) => inspect(agent, force))), nodeInfo()])
  return { tools, node, checkedAt: Date.now() }
}
