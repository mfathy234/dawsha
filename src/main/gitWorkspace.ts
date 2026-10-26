import { open, readdir, realpath, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  MAX_BASELINE_UNTRACKED,
  parseNumstatZ,
  sanitizeBaseline,
  validateRepoPaths,
  type GitDiffResult,
  type FileAgainstBaseResult,
  type GitFileEntry,
  type ProjectFileResult,
  type ProjectFileWriteResult,
  type ProjectFilesResult,
  type SessionBaseline,
  type SessionBaselineResult,
  type SessionStatusResult
} from '../shared/gitStatus'
import { asAddedDiff, git, hasHead, insideRoot, readTextFile, repoRoot, repoStatus } from './gitCommit'

const MAX_LISTED = 20_000
const MAX_WALKED = 5_000
const MAX_READ_BYTES = 1024 * 1024
const MAX_DIFF_CHARS = 200_000
const SKIPPED_DIRS = new Set(['.git', 'node_modules'])

const splitZ = (text: string): string[] => text.split('\0').filter((entry) => entry !== '')

async function walk(folder: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  const pending = ['']
  while (pending.length > 0) {
    const dir = pending.shift() as string
    let entries
    try {
      entries = await readdir(join(folder, dir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) pending.push(path)
      } else if (entry.isFile()) {
        files.push(path)
        if (files.length >= MAX_WALKED) return { files, truncated: true }
      }
    }
  }
  return { files, truncated: false }
}

// Every file under the project, paths relative to the repository root (or the folder outside git).
// Files git ignores are left out so node_modules and build output do not swamp the list.
export async function projectFiles(folder: unknown): Promise<ProjectFilesResult> {
  if (typeof folder !== 'string' || folder === '') return { ok: false, error: 'No project folder.' }
  const root = await repoRoot(folder)
  if (!root) {
    const walked = await walk(folder)
    return { ok: true, files: walked.files.sort(), truncated: walked.truncated, repo: false }
  }
  // Ask git for the folder's place in the repo: comparing paths breaks when one side went through a symlink
  // (macOS /var is /private/var) or a Windows short name.
  const prefix = await git(folder, ['rev-parse', '--show-prefix'])
  const scope = prefix.ok ? prefix.stdout.trim().replace(/\/$/, '') : ''
  const listed = await git(root, ['ls-files', '-z', '-c', '-o', '--exclude-standard', '--', scope || '.'])
  if (!listed.ok) return { ok: false, error: listed.message }
  const all = [...new Set(splitZ(listed.stdout))].sort()
  return { ok: true, files: all.slice(0, MAX_LISTED), truncated: all.length > MAX_LISTED, repo: true }
}

type Resolved = { ok: true; root: string; rel: string; full: string; realRel: string } | { ok: false; error: string }

// The one validator for a project file: relative path checks, then the real location (symlinks resolved)
// must still be inside the project's real root. realRel is that location relative to the real root, in its
// on-disk casing, for git.
async function resolveProjectFile(folder: unknown, path: unknown): Promise<Resolved> {
  if (typeof folder !== 'string' || folder === '') return { ok: false, error: 'No project folder.' }
  const checked = validateRepoPaths([path])
  if (!checked.ok) return { ok: false, error: checked.error }
  const rel = checked.paths[0]
  if (process.platform === 'win32' && rel.includes(':')) return { ok: false, error: `Invalid file path: ${rel}` }
  const root = (await repoRoot(folder)) ?? folder
  const lexical = insideRoot(root, rel)
  if (!lexical) return { ok: false, error: `Path is outside the project: ${rel}` }
  try {
    const realRoot = await realpath(root)
    const full = await realpath(lexical)
    if (!insideRoot(realRoot, full)) return { ok: false, error: `Path is outside the project: ${rel}` }
    return { ok: true, root, rel, full, realRel: relative(realRoot, full).replace(/\\/g, '/') }
  } catch {
    return { ok: false, error: `${rel} no longer exists.` }
  }
}

async function readResolved(target: Extract<Resolved, { ok: true }>): Promise<ProjectFileResult> {
  let size: number
  let mtimeMs: number
  try {
    const info = await stat(target.full)
    if (!info.isFile()) return { ok: false, error: `${target.rel} is not a file.` }
    size = info.size
    mtimeMs = info.mtimeMs
  } catch {
    return { ok: false, error: `${target.rel} no longer exists.` }
  }
  if (size > MAX_READ_BYTES) return { ok: true, text: null, size, reason: 'large', mtimeMs }
  const text = await readTextFile(target.full)
  return text === null ? { ok: true, text: null, size, reason: 'binary', mtimeMs } : { ok: true, text, size, mtimeMs }
}

// One project file as text, refusing paths outside the project, binary files and very large files.
export async function readProjectFile(folder: unknown, path: unknown): Promise<ProjectFileResult> {
  const target = await resolveProjectFile(folder, path)
  return target.ok ? readResolved(target) : target
}

// Saves an existing text file through one open handle, so the checks and the write see the same file.
// A changed mtime means someone else wrote it since it was read.
export async function writeProjectFile(folder: unknown, path: unknown, text: unknown, expectedMtime: unknown): Promise<ProjectFileWriteResult> {
  if (typeof text !== 'string' || typeof expectedMtime !== 'number' || !Number.isFinite(expectedMtime)) return { ok: false, error: 'Invalid save request.' }
  if (Buffer.byteLength(text, 'utf8') > MAX_READ_BYTES) return { ok: false, error: 'File is too large to save here.' }
  const target = await resolveProjectFile(folder, path)
  if (!target.ok) return target
  let handle
  try {
    handle = await open(target.full, 'r+')
  } catch (error) {
    return { ok: false, error: `Could not open ${target.rel}: ${(error as Error).message}` }
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) return { ok: false, error: `${target.rel} is not a file.` }
    if (info.size > MAX_READ_BYTES) return { ok: false, error: `${target.rel} is too large to edit here.` }
    const bytes = await handle.readFile()
    if (bytes.includes(0)) return { ok: false, error: `${target.rel} is a binary file.` }
    if (info.mtimeMs !== expectedMtime) return { ok: false, conflict: true, error: `${target.rel} changed on disk.` }
    const out = bytes.toString('utf8').includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text
    await handle.truncate(0)
    await handle.write(out, 0, 'utf8')
    await handle.sync()
    return { ok: true, mtimeMs: (await handle.stat()).mtimeMs }
  } catch (error) {
    return { ok: false, error: `Could not save ${target.rel}: ${(error as Error).message}` }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function mergeBase(root: string): Promise<string | null> {
  if (!(await hasHead(root))) return null
  for (const ref of ['origin/main', 'main', 'master']) {
    if (!(await git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`])).ok) continue
    const base = await git(root, ['merge-base', 'HEAD', ref])
    if (base.ok && base.stdout.trim()) return base.stdout.trim()
  }
  return 'HEAD'
}

// The file's text at the merge base with main (null for a file that is new on this branch) next to the working copy.
// A base over the size cap comes back as null with reason 'large'.
export async function fileAgainstBase(folder: unknown, path: unknown): Promise<FileAgainstBaseResult> {
  const target = await resolveProjectFile(folder, path)
  if (!target.ok) return target
  const current = await readResolved(target)
  if (!current.ok) return current
  if (current.text === null) return { ok: false, error: current.reason === 'large' ? 'File is too large to compare.' : 'File is binary.' }
  const root = await repoRoot(folder)
  const base = root ? await mergeBase(root) : null
  if (!root || !base) return { ok: true, base: null, text: current.text }
  const shown = await git(root, ['show', `${base}:${target.realRel}`])
  if ((shown.ok && Buffer.byteLength(shown.stdout, 'utf8') > MAX_READ_BYTES) || (!shown.ok && /maxBuffer/i.test(shown.message))) return { ok: true, base: null, text: current.text, reason: 'large' }
  return { ok: true, base: shown.ok ? shown.stdout : null, text: current.text }
}

// Records the repo state when a session starts, without touching the working tree or the stash list.
export async function sessionBaseline(folder: unknown): Promise<SessionBaselineResult> {
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  const at = Date.now()
  const stash = await git(root, ['stash', 'create'])
  let ref = stash.ok ? stash.stdout.trim() || null : null
  if (!ref && (await hasHead(root))) {
    const head = await git(root, ['rev-parse', 'HEAD'])
    ref = head.ok ? head.stdout.trim() || null : null
  }
  const others = await git(root, ['ls-files', '-z', '-o', '--exclude-standard'])
  const untracked = others.ok ? splitZ(others.stdout).slice(0, MAX_BASELINE_UNTRACKED) : []
  return { ok: true, baseline: { ref, at, untracked } }
}

async function commitExists(root: string, ref: string | null): Promise<boolean> {
  return ref !== null && (await git(root, ['cat-file', '-e', `${ref}^{commit}`])).ok
}

async function untrackedSince(root: string, file: GitFileEntry, baseline: SessionBaseline, known: Set<string>): Promise<boolean> {
  if (!known.has(file.path)) return true
  try {
    return (await stat(join(root, file.path))).mtimeMs > baseline.at
  } catch {
    return false
  }
}

// The uncommitted files this session changed: tracked files that differ from the baseline, and
// untracked files that are new or were edited since it started. Counts are against the baseline.
// When the baseline commit is gone (git gc on a very old session), it falls back to all changes.
export async function sessionStatus(folder: unknown, rawBaseline: unknown): Promise<SessionStatusResult> {
  const current = await repoStatus(folder)
  if (!current.ok) return current
  const baseline = sanitizeBaseline(rawBaseline)
  if (!baseline) return { ok: false, error: 'This session has no starting point recorded.' }
  const root = current.status.root
  if (!(await commitExists(root, baseline.ref))) return { ok: true, status: current.status, since: baseline.at, fellBack: true }
  const numstat = await git(root, ['diff', baseline.ref as string, '--numstat', '-z', '-M'])
  const counts = new Map(parseNumstatZ(numstat.ok ? numstat.stdout : '').map((entry) => [entry.path, entry]))
  const known = new Set(baseline.untracked)
  const files: GitFileEntry[] = []
  for (const file of current.status.files) {
    if (file.untracked) {
      if (await untrackedSince(root, file, baseline, known)) files.push(file)
      continue
    }
    const count = counts.get(file.path)
    if (count) files.push({ ...file, added: count.added, removed: count.removed })
  }
  return { ok: true, status: { ...current.status, files }, since: baseline.at, fellBack: false }
}

// A file's diff against the session's starting point instead of the last commit.
export async function fileDiffSince(folder: unknown, path: unknown, rawBaseline: unknown): Promise<GitDiffResult> {
  const checked = validateRepoPaths([path])
  if (!checked.ok) return { ok: false, error: checked.error }
  const baseline = sanitizeBaseline(rawBaseline)
  const current = await repoStatus(folder)
  if (!current.ok) return { ok: false, error: current.error }
  const root = current.status.root
  const entry = current.status.files.find((file) => file.path === checked.paths[0])
  if (!entry) return { ok: true, text: '' }
  if (entry.untracked) {
    const text = await readTextFile(join(root, entry.path))
    return { ok: true, text: text === null ? '' : asAddedDiff(entry.path, text) }
  }
  const ref = baseline && (await commitExists(root, baseline.ref)) ? (baseline.ref as string) : (await hasHead(root)) ? 'HEAD' : null
  const args = ref ? ['diff', ref] : ['diff', '--cached']
  const paths = entry.origPath ? [entry.origPath, entry.path] : [entry.path]
  const diff = await git(root, [...args, '--no-color', '-M', '--', ...paths])
  if (!diff.ok) return { ok: false, error: diff.message }
  return { ok: true, text: diff.stdout.length > MAX_DIFF_CHARS ? diff.stdout.slice(0, MAX_DIFF_CHARS) : diff.stdout }
}
