import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, extname, isAbsolute, join } from 'node:path'

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function resolveExecutable(command: string, extraDirs: string[] = [], platform = process.platform): string | null {
  if (isAbsolute(command) || command.includes('\\') || command.includes('/')) {
    return isFile(command) ? command : null
  }
  const extensions = platform !== 'win32' || extname(command)
    ? ['']
    : (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
  const dirs = [...(process.env.PATH ?? '').split(delimiter), ...extraDirs].filter(Boolean)
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, command + ext)
      if (existsSync(candidate) && isFile(candidate)) return candidate
    }
  }
  return null
}

export function platformExecutableDirs(platform = process.platform, home = homedir()): string[] {
  if (platform !== 'darwin') return []
  const dirs = [
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.local', 'share', 'mise', 'shims'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin'
  ]
  const addChildren = (parent: string, child: (name: string) => string): void => {
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(child(entry.name))
      }
    } catch {
      return
    }
  }
  addChildren(join(home, '.nvm', 'versions', 'node'), (version) => join(home, '.nvm', 'versions', 'node', version, 'bin'))
  addChildren(join(home, '.local', 'share', 'fnm', 'node-versions'), (version) => join(home, '.local', 'share', 'fnm', 'node-versions', version, 'installation', 'bin'))
  addChildren(join(home, '.fnm', 'node-versions'), (version) => join(home, '.fnm', 'node-versions', version, 'installation', 'bin'))
  addChildren(join(home, '.local', 'share', 'mise', 'installs', 'node'), (version) => join(home, '.local', 'share', 'mise', 'installs', 'node', version, 'bin'))
  return [...new Set(dirs)]
}

export const claudeFallbackDirs = (): string[] => [join(homedir(), '.local', 'bin')]

export function splitArgs(value: string | undefined): string[] {
  if (!value) return []
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return []
    }
  }
  return trimmed.split(/\s+/).filter(Boolean)
}
