import { execFile } from 'node:child_process'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path'
import type { GitResult } from '../shared/types'
import { detectSetupCommands, isWorktreeLocalPath, matchesWorktreeInclude, parseWorktreeInclude, suggestLocalFiles, WORKTREE_SKIP_DIRS, type SetupFile, type WorktreeSetupInspectResult } from '../shared/worktreeSetup'
import { mainCheckoutOf } from './worktreeRoots'

const MAX_COPY_BYTES = 50 * 1024 * 1024
const MAX_FILES = 20_000
const MAX_INCLUDE_BYTES = 64 * 1024
const INCLUDE_NAME = '.worktreeinclude'

/** Inputs must already be canonical filesystem paths when used for access checks. */
export function isPathInside(root: string, path: string, platform = process.platform): boolean {
  const paths = platform === 'win32' ? win32 : { relative, resolve, isAbsolute }
  const base = platform === 'win32' ? root.toLowerCase() : root
  const candidate = platform === 'win32' ? path.toLowerCase() : path
  const rel = paths.relative(paths.resolve(base), paths.resolve(candidate))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${platform === 'win32' ? '\\' : '/'}`) && !paths.isAbsolute(rel)
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

async function mainRoot(folder: string): Promise<string> {
  const root = await mainCheckoutOf(folder)
  if (!root) throw new Error('This project is not a git repository.')
  return realpathSync.native(root)
}

function readInclude(root: string): { exists: boolean; patterns: string } {
  const path = join(root, INCLUDE_NAME)
  let stat: ReturnType<typeof lstatSync>
  try { stat = lstatSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, patterns: '' }
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile() || !isPathInside(root, realpathSync.native(path))) throw new Error('.worktreeinclude must be a regular file inside the main checkout.')
  if (stat.size > MAX_INCLUDE_BYTES) throw new Error('.worktreeinclude is too large. Keep it below 64 KB.')
  return { exists: true, patterns: readFileSync(path, 'utf8') }
}

/** Git can traverse Windows junctions while listing ignored files, so exclude links before asking it to scan. */
function linkPaths(root: string): string[] {
  const links: string[] = []
  let visited = 0
  const walk = (folder: string, prefix: string, depth: number): void => {
    if (depth > 32) throw new Error('The local-file scan reached its folder depth limit. Narrow the project folder.')
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (++visited > MAX_FILES) throw new Error('The local-file scan reached its file limit. Narrow the project folder.')
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) { links.push(rel); continue }
      if (!entry.isDirectory() || (WORKTREE_SKIP_DIRS as readonly string[]).includes(entry.name.toLowerCase())) continue
      const full = join(folder, entry.name)
      if (!existsSync(join(full, '.git'))) walk(full, rel, depth + 1)
    }
  }
  walk(root, '', 0)
  return links
}

function ignoredFiles(root: string, rules?: readonly string[]): Promise<string[]> {
  const links = linkPaths(root)
  if (rules) for (const path of links) {
    if (!matchesWorktreeInclude(path, rules) && !matchesWorktreeInclude(`${path}/__link__`, rules)) continue
    let resolved: string
    try { resolved = realpathSync.native(join(root, path)) } catch { throw new Error(`Cannot copy ${path}: its link target is unavailable.`) }
    if (!isPathInside(root, resolved)) throw new Error(`Cannot copy ${path}: it points outside the main checkout.`)
  }
  return new Promise((resolveFiles, reject) => {
    const excludes = [...WORKTREE_SKIP_DIRS.map((name) => `:(exclude,glob)**/${name}/**`), ...links.map((path) => `:(exclude,literal)${path}`)]
    execFile('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', '.', ...excludes], { cwd: root, windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error('Could not list ignored local files. The scan may exceed its limit.')); return }
      const files = stdout.split('\0').filter((path) => path !== '')
      if (files.length > MAX_FILES) { reject(new Error('There are too many ignored local files to scan safely. Narrow the project ignore rules.')); return }
      resolveFiles(files.filter(isWorktreeLocalPath))
    })
  })
}

const manifestName = /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|\.yarnrc\.yml|bun\.lockb?|requirements\.txt|uv\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|pubspec\.lock|pubspec\.yaml|gradlew|pom\.xml)$|\.(?:slnx?|[cfv]sproj)$/i
const contentName = /^(?:package\.json|\.yarnrc\.yml|pubspec\.yaml)$/

/** Bounded manifest walk, excluding dependency trees and nested Git checkouts. */
function setupFiles(root: string): SetupFile[] {
  const found: SetupFile[] = []
  let visited = 0
  const walk = (folder: string, prefix: string, depth: number): void => {
    if (depth > 8) return
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (++visited > MAX_FILES) throw new Error('This project has too many files to detect setup commands safely. Enter the setup command yourself.')
      if (entry.isSymbolicLink()) continue
      const path = join(folder, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name === '.venv' || entry.name === 'venv') {
          for (const executable of ['Scripts/python.exe', 'bin/python']) if (existsSync(join(path, executable))) found.push({ path: `${rel}/${executable}` })
        }
        if ((WORKTREE_SKIP_DIRS as readonly string[]).includes(entry.name.toLowerCase()) || existsSync(join(path, '.git'))) continue
        walk(path, rel, depth + 1)
      } else if (entry.isFile() && manifestName.test(entry.name)) {
        let content: string | undefined
        if (contentName.test(entry.name) && lstatSync(path).size <= MAX_INCLUDE_BYTES) content = readFileSync(path, 'utf8')
        found.push({ path: rel, content })
      }
    }
  }
  walk(root, '', 0)
  return found
}

export async function inspectWorktreeSetup(folder: string): Promise<WorktreeSetupInspectResult> {
  try {
    const root = await mainRoot(folder)
    const include = readInclude(root)
    const ignored = await ignoredFiles(root)
    const safeFiles = ignored.filter((path) => {
      const full = join(root, path)
      try { return isPathInside(root, realpathSync.native(full)) && lstatSync(full).isFile() } catch { return false }
    })
    return { ok: true, ...include, suggestions: suggestLocalFiles(safeFiles), commands: detectSetupCommands(setupFiles(root)) }
  } catch (error) { return { ok: false, error: errorText(error) } }
}

export async function saveWorktreeSetup(folder: string, patterns: unknown): Promise<GitResult> {
  if (typeof patterns !== 'string' || patterns.includes('\0') || Buffer.byteLength(patterns) > MAX_INCLUDE_BYTES || parseWorktreeInclude(patterns).length > 1_000) return { ok: false, error: 'Keep .worktreeinclude below 64 KB and 1,000 patterns.' }
  try {
    const root = await mainRoot(folder)
    const current = readInclude(root)
    writeFileSync(join(root, INCLUDE_NAME), patterns, { encoding: 'utf8', flag: current.exists ? 'w' : 'wx' })
    return { ok: true }
  } catch (error) { return { ok: false, error: errorText(error) } }
}

type CopyResult = { ok: true; files: number; bytes: number } | { ok: false; error: string }

/** Copies only ignored, explicitly selected regular files. Never links or overwrites files in the new checkout. */
export async function copyWorktreeEnvironment(folder: string, destination: string, maxBytes = MAX_COPY_BYTES): Promise<CopyResult> {
  try {
    const root = await mainRoot(folder)
    const target = realpathSync.native(destination)
    if (target === root) throw new Error('Local files must be copied to a separate worktree.')
    const include = readInclude(root)
    if (!include.exists) return { ok: true, files: 0, bytes: 0 }
    const rules = parseWorktreeInclude(include.patterns)
    const plan: Array<{ source: string; destination: string; size: number }> = []
    let bytes = 0
    for (const path of await ignoredFiles(root, rules)) {
      if (!matchesWorktreeInclude(path, rules)) continue
      const source = join(root, path)
      if (!isPathInside(root, realpathSync.native(source))) throw new Error(`Cannot copy ${path}: it points outside the main checkout.`)
      const stat = lstatSync(source)
      if (stat.isSymbolicLink() || !stat.isFile()) continue
      bytes += stat.size
      if (bytes > maxBytes) throw new Error(`Local files exceed the ${Math.round(maxBytes / (1024 * 1024))} MB copy limit. Narrow .worktreeinclude and try again.`)
      plan.push({ source, destination: join(target, path), size: stat.size })
    }
    // Validate every existing parent before copying anything, including junctions in the new checkout.
    const checkDestination = (path: string): void => {
      let parent = path
      while (!existsSync(parent)) {
        if (!isPathInside(target, parent)) throw new Error('A local file destination leaves the new worktree.')
        parent = dirname(parent)
      }
      const resolved = realpathSync.native(parent)
      if (resolved !== target && !isPathInside(target, resolved)) throw new Error('A local file destination points outside the new worktree.')
    }
    for (const file of plan) {
      checkDestination(file.destination)
      if (existsSync(file.destination)) throw new Error(`Cannot copy ${relative(target, file.destination)}: it already exists in the new worktree.`)
    }
    for (const file of plan) {
      mkdirSync(dirname(file.destination), { recursive: true })
      checkDestination(file.destination)
      const current = lstatSync(file.source)
      if (!isPathInside(root, realpathSync.native(file.source)) || !current.isFile() || current.size !== file.size) throw new Error('A local file changed while it was being copied. Try again.')
      copyFileSync(file.source, file.destination, constants.COPYFILE_EXCL)
    }
    return { ok: true, files: plan.length, bytes }
  } catch (error) { return { ok: false, error: `Worktree local files: ${errorText(error)}` } }
}
