import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  SEARCH_BUDGET_MS, SEARCH_MAX_MATCHES, SEARCH_MAX_PER_FILE, WALK_MAX_BYTES, WALK_MAX_FILES, buildGrepArgs, matchesInclude, matcherFor, parseGrepOutput, pcreUnsupported, searchTextUntil, shouldSkipDir, shouldSkipFile, validateSearchRequest,
  type SearchFile, type SearchRequest, type SearchResult
} from '../shared/fileSearch'
import { IMAGE_MAX_BYTES, imageMime, type FileCommit, type FileImageResult, type FileLogResult } from '../shared/filePreview'
import { isHtmlPath } from '../shared/filePreview'
import { dedupeRoots, folderName, isAbsolutePath, type LinkedRepo } from '../shared/linkedRepos'
import { git, repoRoot } from './gitCommit'
import { mergeBase, resolveProjectFile, resolveProjectPath } from './gitWorkspace'
import { knownProjectFolder } from './knownFolder'

const GREP_MS = 20_000
const MAX_BUFFER = 16 * 1024 * 1024

interface Run {
  code: number | string | null
  stdout: string
  stderr: string
}

function run(root: string, args: string[], timeout: number): Promise<Run> {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, timeout, maxBuffer: MAX_BUFFER, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      resolve({ code: error ? ((error as NodeJS.ErrnoException & { code?: number | string }).code ?? 1) : 0, stdout: `${stdout}`, stderr: `${stderr}` })
    })
  })
}

/** Null when git cannot run the regular expression engine this request needs, so the caller can walk instead. */
async function gitSearch(root: string, folder: string, request: SearchRequest): Promise<SearchResult | null> {
  const prefix = await git(folder, ['rev-parse', '--show-prefix'])
  const scope = prefix.ok ? prefix.stdout.trim().replace(/\/$/, '') : ''
  const out = await run(root, buildGrepArgs(request, scope, request.regex), GREP_MS)
  if (request.regex && out.code !== 0 && out.code !== 1 && pcreUnsupported(out.stderr)) return null
  // Exit 1 is "no match"; a full buffer still leaves usable output.
  if (out.code !== 0 && out.code !== 1 && out.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && out.stdout === '') {
    return { ok: false, error: out.stderr.trim().split('\n')[0] || 'The search failed.' }
  }
  const parsed = parseGrepOutput(out.stdout, SEARCH_MAX_MATCHES)
  return { ok: true, ...parsed, truncated: parsed.truncated || out.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', engine: 'git' }
}

/** A bounded walk for folders that are not git repositories: skips dependency and build folders, binaries, links and big files. */
export async function walkSearch(folder: string, request: SearchRequest, budgetMs = SEARCH_BUDGET_MS): Promise<SearchResult> {
  const deadline = Date.now() + budgetMs
  const matcher = matcherFor(request)
  if (!matcher) return { ok: false, error: 'Not a valid regular expression.' }
  const files: SearchFile[] = []
  let total = 0
  let visited = 0
  let truncated = false
  const pending = ['']
  while (pending.length > 0 && !truncated) {
    if (Date.now() > deadline) {
      truncated = true
      break
    }
    const dir = pending.shift() as string
    let entries
    try {
      entries = await readdir(join(folder, dir), { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) pending.push(path)
        continue
      }
      if (!entry.isFile() || shouldSkipFile(entry.name) || !matchesInclude(path, request.include)) continue
      visited += 1
      if (visited > WALK_MAX_FILES || Date.now() > deadline) {
        truncated = true
        break
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
      let bytes: Buffer
      try {
        if ((await stat(join(folder, path))).size > WALK_MAX_BYTES) continue
        bytes = await readFile(join(folder, path))
      } catch {
        continue
      }
      if (bytes.includes(0)) continue
      const { matches: found, expired } = searchTextUntil(bytes.toString('utf8'), matcher, SEARCH_MAX_PER_FILE, deadline)
      if (expired) truncated = true
      if (found.length === 0) {
        if (expired) break
        continue
      }
      const room = SEARCH_MAX_MATCHES - total
      total += found.length
      files.push({ path, matches: found.slice(0, Math.max(room, 0)) })
      if (total >= SEARCH_MAX_MATCHES || expired) {
        truncated = true
        break
      }
    }
  }
  return { ok: true, files: files.filter((file) => file.matches.length > 0), total, truncated, engine: 'walk' }
}

/** Find in files for a checkout already accepted by the known-folder gate. */
export async function searchFiles(folder: string, raw: unknown): Promise<SearchResult> {
  const checked = validateSearchRequest(raw)
  if (!checked.ok) return checked
  const root = await repoRoot(folder)
  const viaGit = root ? await gitSearch(root, folder, checked.request) : null
  return viaGit ?? walkSearch(folder, checked.request)
}

/** The real path of an HTML file to hand to the OS: both the requested and the resolved path must be HTML, and it must be a regular file. */
export async function htmlToOpen(folder: string, path: unknown): Promise<string | null> {
  if (typeof path !== 'string' || !isHtmlPath(path)) return null
  const full = await resolveProjectPath(folder, path)
  if (!full || !isHtmlPath(full)) return null
  try {
    return (await stat(full)).isFile() ? full : null
  } catch {
    return null
  }
}

/** The last commits that touched a file. */
export async function fileLog(folder: string, path: unknown): Promise<FileLogResult> {
  const target = await resolveProjectFile(folder, path)
  if (!target.ok) return target.missing ? { ok: true, commits: [] } : target
  const root = await repoRoot(folder)
  if (!root) return { ok: true, commits: [] }
  const out = await git(root, ['log', '-n', '20', '--format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e', '--', target.realRel])
  if (!out.ok) return { ok: true, commits: [] }
  const commits: FileCommit[] = out.stdout.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash, short, author, at, subject] = record.split('\x1f')
    return { hash, short, author, at: Number(at) * 1000, subject: subject ?? '' }
  })
  return { ok: true, commits }
}

function showBytes(root: string, spec: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile('git', ['show', spec], { cwd: root, maxBuffer: IMAGE_MAX_BYTES + 1024, encoding: 'buffer', windowsHide: true, timeout: 15_000 }, (error, stdout) => resolve(error ? null : (stdout as unknown as Buffer)))
  })
}

/** An image of the project as a data URL, from the working tree or (base) from the merge base with main. */
export async function readImage(folder: string, path: unknown, base: boolean): Promise<FileImageResult> {
  const mime = typeof path === 'string' ? imageMime(path) : null
  if (!mime) return { ok: false, error: 'Not an image.' }
  const target = await resolveProjectFile(folder, path)
  if (base) {
    const rel = target.ok ? target.realRel : target.missing?.rel
    const root = await repoRoot(folder)
    const at = root ? await mergeBase(root) : null
    const bytes = root && at && rel ? await showBytes(root, `${at}:${rel}`) : null
    if (!bytes) return { ok: false, error: 'There is no version of this image on main.' }
    return { ok: true, dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, size: bytes.length }
  }
  if (!target.ok) return target
  try {
    const info = await stat(target.full)
    if (!info.isFile()) return { ok: false, error: 'Not a file.' }
    if (info.size > IMAGE_MAX_BYTES) return { ok: false, error: 'This image is larger than 8 MB, so it is not shown here.' }
    const bytes = await readFile(target.full)
    return { ok: true, dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, size: bytes.length }
  } catch {
    return { ok: false, error: `${target.rel} no longer exists.` }
  }
}

async function rootOf(path: string): Promise<string | null> {
  let folder = path
  try {
    if (!(await stat(folder)).isDirectory()) folder = dirname(folder)
  } catch {
    return null
  }
  return (await repoRoot(folder)) ?? folder
}

/**
 * Repositories a project's sessions also edited, from folders their edits touched. A repository is only offered as
 * openable when a configured project accepts it through the known-folder check; nothing is added to the project list.
 */
export async function linkedRepos(projects: ReadonlyArray<{ id: string; folder: string }>, projectId: unknown, folders: unknown): Promise<LinkedRepo[]> {
  if (!Array.isArray(folders)) return []
  const candidates = folders.filter((entry): entry is string => typeof entry === 'string' && isAbsolutePath(entry) && !entry.includes('\0')).slice(0, 40)
  const roots = dedupeRoots((await Promise.all(candidates.map(rootOf))).filter((root): root is string => root !== null))
  const out: LinkedRepo[] = []
  for (const root of roots) {
    let accepted: string | null = null
    for (const project of projects) {
      if (await knownProjectFolder([project], root)) {
        accepted = project.id
        break
      }
    }
    if (accepted !== null && accepted === projectId) continue
    out.push({ folder: root, name: folderName(root), projectId: accepted })
    if (out.length >= 8) break
  }
  return out
}
