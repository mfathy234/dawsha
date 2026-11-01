import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { MAX_CONFIG_BYTES } from '../shared/configParse'
import {
  classifyConfigFile,
  readConfigText,
  revealConfigValue,
  type ConfigFile,
  type ConfigReport,
  type ConfigRevealRequest,
  type ConfigRevealResult
} from '../shared/configFiles'
import { containsProjectPath } from './projectContainment'

const MAX_DEPTH = 4
const MAX_DIRS = 600
const MAX_FILES = 80
const SKIPPED = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', 'build', '.vs', '.idea', '.next', '.nuxt', 'target', 'vendor', 'packages', '.venv', 'venv', '__pycache__', 'coverage'])

const posix = (path: string): string => path.split(sep).join('/')

async function walk(root: string): Promise<string[]> {
  const found: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < MAX_DIRS && found.length < MAX_FILES) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number }
    visited++
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIPPED.has(entry.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (entry.isFile() && classifyConfigFile(entry.name) && found.length < MAX_FILES) {
        found.push(posix(relative(root, full)))
      }
    }
  }
  return found.sort((a, b) => a.localeCompare(b))
}

async function readInside(root: string, path: string): Promise<string | { error: string }> {
  const full = resolve(root, path)
  if (!containsProjectPath(root, full)) return { error: 'This file is outside the project.' }
  try {
    const [realRoot, realFile, info] = await Promise.all([realpath(root), realpath(full), lstat(full)])
    if (!containsProjectPath(realRoot, realFile)) return { error: 'This file is outside the project.' }
    if (info.size > MAX_CONFIG_BYTES) return { error: `This file is larger than ${MAX_CONFIG_BYTES / 1024} KB, so it is not read.` }
    const handle = await open(full, 'r')
    try {
      return (await handle.readFile({ encoding: 'utf8' })).slice(0, MAX_CONFIG_BYTES)
    } finally {
      await handle.close()
    }
  } catch {
    return { error: 'This file could not be read.' }
  }
}

/** Every config file of the project with its settings; values that look secret are left out of the result. */
export async function readProjectConfig(root: string): Promise<ConfigReport> {
  const paths = await walk(root)
  const files: ConfigFile[] = []
  for (const path of paths) {
    const info = classifyConfigFile(path.split('/').pop() as string)
    if (!info) continue
    const text = await readInside(root, path)
    files.push(typeof text === 'string' ? readConfigText(path, info, text) : { ...info, path, entries: [], error: text.error })
  }
  return { ok: true, files }
}

/** One masked value, read again from its file when the user asks to see it. */
export async function revealProjectConfig(root: string, request: ConfigRevealRequest): Promise<ConfigRevealResult> {
  if (typeof request?.path !== 'string' || typeof request.key !== 'string' || !Number.isInteger(request.line)) return { ok: false, error: 'That value could not be found.' }
  const info = classifyConfigFile(request.path.split(/[\\/]/).pop() as string)
  if (!info) return { ok: false, error: 'That is not a config file.' }
  const text = await readInside(root, request.path)
  if (typeof text !== 'string') return { ok: false, error: text.error }
  const value = revealConfigValue(info, text, request.key, request.line)
  return value === null ? { ok: false, error: 'The file changed, so the value moved. Reload the tab.' } : { ok: true, value }
}
