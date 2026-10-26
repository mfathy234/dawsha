import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { classifyClaudeInstall, type ClaudeInstall } from '../shared/claudeInstalls'

const SHIM_MAX_BYTES = 16 * 1024
const WINDOWS_NAMES = ['claude.exe', 'claude.cmd', 'claude.bat', 'claude.ps1', 'claude']
const UNIX_NAMES = ['claude']
const PACKAGE_BIN = join('node_modules', '@anthropic-ai', 'claude-code', 'bin')

export interface ScanOptions {
  /** Directories a terminal searches, in order. */
  pathDirs: string[]
  /** Places Claude Code is known to live that are often missing from a GUI app's PATH. */
  extraDirs: string[]
  platform?: NodeJS.Platform
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function readShim(path: string): string | null {
  try {
    if (statSync(path).size > SHIM_MAX_BYTES) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function realOf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

const same = (a: string, b: string, platform: NodeJS.Platform): boolean =>
  platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/** Where each npm / native / package-manager install keeps Claude Code that a GUI app's PATH can miss. */
export function claudeKnownDirs(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const dirs = [join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.claude', 'local', 'node_modules', '.bin')]
  if (platform === 'win32') {
    const appData = env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    dirs.push(
      join(appData, 'npm'),
      join(localAppData, 'pnpm'),
      join(localAppData, 'Volta', 'bin'),
      join(home, '.volta', 'bin')
    )
    for (const value of [env.npm_config_prefix, env.NPM_CONFIG_PREFIX, env.NVM_SYMLINK, env.FNM_MULTISHELL_PATH, env.PNPM_HOME]) {
      if (value) dirs.push(value)
    }
    if (env.VOLTA_HOME) dirs.push(join(env.VOLTA_HOME, 'bin'))
    return [...new Set(dirs)]
  }
  dirs.push(join(home, '.npm-global', 'bin'), join(home, '.volta', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin')
  for (const value of [env.npm_config_prefix, env.NPM_CONFIG_PREFIX]) {
    if (value) dirs.push(join(value, 'bin'))
  }
  return [...new Set(dirs)]
}

/** The first Claude file in a directory, preferring what a terminal would run. */
function candidateIn(dir: string, platform: NodeJS.Platform): string | null {
  for (const name of platform === 'win32' ? WINDOWS_NAMES : UNIX_NAMES) {
    const candidate = join(dir, name)
    if (existsSync(candidate) && isFile(candidate)) return candidate
  }
  return null
}

function dedupeKey(install: ClaudeInstall, real: string, platform: NodeJS.Platform): string {
  const key = install.kind === 'npm' && install.npmPrefix ? `npm:${install.npmPrefix}` : `file:${real}`
  return platform === 'win32' ? key.toLowerCase() : key
}

/**
 * Every Claude Code install under the given directories, in the order a terminal would reach them.
 * Shims that sit next to each other (claude, claude.cmd, claude.ps1) and symlinks to one binary are one install.
 */
export function scanClaudeInstalls(options: ScanOptions): ClaudeInstall[] {
  const platform = options.platform ?? process.platform
  const found: ClaudeInstall[] = []
  const seen = new Set<string>()
  const visited: string[] = []
  const visit = (dirs: string[], onPath: boolean): void => {
    for (const dir of dirs) {
      if (!dir || visited.some((v) => same(v, dir, platform))) continue
      visited.push(dir)
      const path = candidateIn(dir, platform)
      if (!path) continue
      const realPath = realOf(path)
      const classified = classifyClaudeInstall({ path, realPath, shim: readShim(path) })
      const install: ClaudeInstall = { path, ...classified, onPath, version: null }
      const key = dedupeKey(install, realPath, platform)
      if (seen.has(key)) continue
      seen.add(key)
      found.push(install)
    }
  }
  visit(options.pathDirs, true)
  visit(options.extraDirs, false)
  return found
}

/** The program a Windows npm install really runs, so Dawsha can start it without the .cmd shim. */
export function npmClaudeBinary(install: ClaudeInstall): string | null {
  if (install.kind !== 'npm' || !install.npmPrefix) return null
  const exe = join(install.npmPrefix, PACKAGE_BIN, 'claude.exe')
  return existsSync(exe) ? exe : null
}

export const splitPath = (value: string | undefined): string[] => (value ?? '').split(delimiter).filter(Boolean)
