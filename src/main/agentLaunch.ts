import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { claudeFallbackDirs, platformExecutableDirs, resolveExecutable, splitArgs } from './executables'
import { AGENT_NAMES, FULL_ACCESS_FLAGS } from '../shared/agents'
import { promptArgs } from '../shared/compare'
import type { AgentKind, SpawnRequest } from '../shared/types'

export interface LaunchSpec {
  file: string
  args: string[]
}

const CODEX_VENDOR = join('@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')

export const claudeCommand = (platform = process.platform): string => process.env.DAWSHA_CLAUDE_COMMAND || (platform === 'win32' ? 'claude.exe' : 'claude')

export const codexCommand = (): string => process.env.DAWSHA_CODEX_COMMAND || 'codex'

export const geminiCommand = (): string => process.env.DAWSHA_GEMINI_COMMAND || 'gemini'

export function shellCommand(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (env.DAWSHA_SHELL) return env.DAWSHA_SHELL
  if (platform === 'darwin') return env.SHELL || '/bin/zsh'
  if (platform === 'linux') return env.SHELL || '/bin/bash'
  return resolveExecutable('pwsh.exe') ? 'pwsh.exe' : 'powershell.exe'
}

export function agentCommand(agent: AgentKind, platform = process.platform): string {
  return agent === 'claude' ? claudeCommand(platform) : agent === 'codex' ? codexCommand() : geminiCommand()
}

export function locateCodexBinary(pathDirs: string[]): string | null {
  for (const dir of pathDirs) {
    if (!dir || !existsSync(join(dir, 'codex.cmd'))) continue
    const nested = join(dir, 'node_modules', '@openai', 'codex', 'node_modules', CODEX_VENDOR)
    const hoisted = join(dir, 'node_modules', CODEX_VENDOR)
    for (const candidate of [nested, hoisted]) if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveCodex(pathDirs: string[], platform = process.platform): LaunchSpec | null {
  const command = codexCommand()
  if (process.env.DAWSHA_CODEX_COMMAND) {
    const file = resolveExecutable(command, [], platform)
    return file ? { file, args: [] } : null
  }
  if (platform !== 'win32') {
    const file = resolveExecutable(command, [...pathDirs, ...platformExecutableDirs(platform)], platform)
    return file ? { file, args: [] } : null
  }
  const direct = resolveExecutable('codex.exe')
  if (direct) return { file: direct, args: [] }
  const binary = locateCodexBinary(pathDirs)
  if (binary) return { file: binary, args: [] }
  const cmd = resolveExecutable('codex.cmd')
  if (cmd) return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'codex'] }
  return null
}

const GEMINI_BUNDLE = join('node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js')

export function locateGeminiEntry(pathDirs: string[]): LaunchSpec | null {
  for (const dir of pathDirs) {
    if (!dir || !existsSync(join(dir, 'gemini.cmd'))) continue
    const bundle = join(dir, GEMINI_BUNDLE)
    if (!existsSync(bundle)) continue
    const bundled = join(dir, 'node.exe')
    const node = existsSync(bundled) ? bundled : resolveExecutable('node.exe')
    if (node) return { file: node, args: [bundle] }
  }
  return null
}

function resolveGemini(pathDirs: string[], platform = process.platform): LaunchSpec | null {
  if (process.env.DAWSHA_GEMINI_COMMAND) {
    const file = resolveExecutable(geminiCommand(), [], platform)
    return file ? { file, args: [] } : null
  }
  if (platform !== 'win32') {
    const file = resolveExecutable(geminiCommand(), [...pathDirs, ...platformExecutableDirs(platform)], platform)
    return file ? { file, args: [] } : null
  }
  const entry = locateGeminiEntry(pathDirs)
  if (entry) return entry
  if (resolveExecutable('gemini.cmd')) return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'gemini'] }
  return null
}

function geminiArgs(request: Pick<SpawnRequest, 'resume' | 'sessionId'>): string[] {
  if (!request.sessionId) return []
  return request.resume ? ['--resume', request.sessionId] : ['--session-id', request.sessionId]
}

function sessionArgs(request: Pick<SpawnRequest, 'agent' | 'resume' | 'sessionId'>): string[] {
  if (request.agent === 'gemini') return geminiArgs(request)
  if (!request.resume) return []
  if (request.agent === 'claude') return request.sessionId ? ['-r', request.sessionId] : ['--continue']
  return request.sessionId ? ['resume', request.sessionId] : []
}

export function agentArgs(
  request: Pick<SpawnRequest, 'agent' | 'resume' | 'sessionId' | 'fullAccess'>,
  overridden: boolean
): string[] {
  if (overridden) return []
  const session = sessionArgs(request)
  if (!request.fullAccess || request.agent === 'shell') return session
  const flag = FULL_ACCESS_FLAGS[request.agent]
  return request.agent === 'codex' ? [...session, flag] : [flag, ...session]
}

export function shellArgs(file: string, command?: string, platform = process.platform): string[] {
  const name = (file.split(/[\\/]/).pop() ?? file).toLowerCase()
  if (name === 'cmd.exe' || name === 'cmd') return command === undefined ? [] : ['/d', '/s', '/c', command]
  if (platform !== 'win32') return command === undefined ? (process.env.DAWSHA_SHELL ? [] : ['-l']) : ['-lc', command]
  if (command !== undefined) return ['-NoLogo', '-Command', command]
  return process.env.DAWSHA_SHELL ? [] : ['-NoLogo']
}

/** extraArgs (orchestrator model, effort, MCP config) go after the agent's own args and before the prompt. */
export function launchSpec(request: SpawnRequest, platform = process.platform, extraArgs: readonly string[] = []): LaunchSpec | string {
  if (request.agent === 'shell') {
    const command = shellCommand(platform)
    const file = resolveExecutable(command, [], platform)
    if (!file) return `Shell not found: ${command}`
    return { file, args: shellArgs(file, request.command, platform) }
  }
  const pathDirs = (process.env.PATH ?? '').split(delimiter)
  if (request.agent === 'codex') {
    const base = resolveCodex(pathDirs, platform)
    if (!base) return `Could not find ${codexCommand()}. Install Codex CLI (npm i -g @openai/codex) or set DAWSHA_CODEX_COMMAND.`
    const overridden = Boolean(process.env.DAWSHA_CODEX_COMMAND)
    const extra = splitArgs(process.env.DAWSHA_CODEX_ARGS)
    const initial = promptFor(base, request)
    if (typeof initial === 'string') return initial
    return { file: base.file, args: [...base.args, ...extra, ...agentArgs(request, overridden), ...extraArgs, ...initial] }
  }
  if (request.agent === 'gemini') {
    const base = resolveGemini(pathDirs, platform)
    if (!base) return `Could not find ${geminiCommand()}. Install Gemini CLI (npm i -g @google/gemini-cli) or set DAWSHA_GEMINI_COMMAND.`
    const overridden = Boolean(process.env.DAWSHA_GEMINI_COMMAND)
    const extra = splitArgs(process.env.DAWSHA_GEMINI_ARGS)
    const initial = promptFor(base, request)
    if (typeof initial === 'string') return initial
    return { file: base.file, args: [...base.args, ...extra, ...agentArgs(request, overridden), ...extraArgs, ...initial] }
  }
  const command = claudeCommand(platform)
  const file = resolveExecutable(command, [...claudeFallbackDirs(), ...platformExecutableDirs(platform)], platform)
  if (!file) return `Could not find ${command}. Install Claude Code or set DAWSHA_CLAUDE_COMMAND.`
  const initial = promptFor({ file, args: [] }, request)
  if (typeof initial === 'string') return initial
  const args = [
    ...splitArgs(process.env.DAWSHA_CLAUDE_ARGS),
    ...agentArgs(request, Boolean(process.env.DAWSHA_CLAUDE_COMMAND)),
    ...extraArgs,
    ...initial
  ]
  return { file, args }
}

function viaCmdShim(base: LaunchSpec): boolean {
  const name = (base.file.split(/[\\/]/).pop() ?? '').toLowerCase()
  return name === 'cmd.exe' && base.args[0] === '/d'
}

function promptFor(base: LaunchSpec, request: Pick<SpawnRequest, 'agent' | 'prompt'>): string[] | string {
  if (!request.prompt || request.agent === 'shell') return []
  if (viaCmdShim(base)) {
    return `${AGENT_NAMES[request.agent]} is installed as a .cmd shim, which cannot take a prompt safely. Install it again with npm i -g so its native program is found, or start it without a prompt.`
  }
  return promptArgs(request.agent, request.prompt)
}

export const codexHome = (): string => process.env.DAWSHA_CODEX_HOME ?? join(process.env.USERPROFILE ?? homedir(), '.codex')


export const geminiHome = (): string => process.env.DAWSHA_GEMINI_HOME ?? join(process.env.USERPROFILE ?? homedir(), '.gemini')
