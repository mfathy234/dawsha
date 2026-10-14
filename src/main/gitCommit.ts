import { execFile } from 'node:child_process'
import { readFile, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  expandRenames,
  parseNumstatZ,
  parseStatusV2,
  validateRepoPaths,
  withCounts,
  type CommitRequest,
  type DiscardRequest,
  type GitCommitResult,
  type GitDiffResult,
  type GitFileEntry,
  type RepoStatusResult
} from '../shared/gitStatus'
import type { GitResult } from '../shared/types'
import { forgetChanges } from './git'

const QUICK_MS = 15_000
const SLOW_MS = 180_000
const MAX_BUFFER = 16 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_DIFF_CHARS = 200_000

interface Outcome {
  ok: boolean
  stdout: string
  message: string
}

export function git(root: string, args: string[], timeout = QUICK_MS, literalPathspecs = true): Promise<Outcome> {
  return new Promise((resolveRun) => {
    execFile(
      'git',
      [...(literalPathspecs ? ['--literal-pathspecs'] : []), '-c', 'core.quotepath=false', ...args],
      {
        cwd: root,
        timeout,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }
      },
      (error, stdout, stderr) => {
        const text = `${stderr}`.trim() || `${stdout}`.trim() || (error ? error.message : '')
        resolveRun({ ok: !error, stdout: `${stdout}`, message: text })
      }
    )
  })
}

const locked = new Set<string>()

export const REPO_BUSY = 'Another git operation is still running in this folder.'

export function tryLockRepo(root: string): boolean {
  if (locked.has(root)) return false
  locked.add(root)
  return true
}

export function unlockRepo(root: string): void {
  locked.delete(root)
}

async function whileLocked<T extends { ok: boolean }>(folder: unknown, run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  const root = await repoRoot(folder)
  if (!root) return run()
  if (!tryLockRepo(root)) return { ok: false, error: REPO_BUSY }
  try {
    return await run()
  } finally {
    unlockRepo(root)
  }
}

export async function repoRoot(folder: unknown): Promise<string | null> {
  if (typeof folder !== 'string' || folder === '') return null
  const result = await git(folder, ['rev-parse', '--show-toplevel'])
  const root = result.stdout.trim()
  return result.ok && root ? root : null
}

export async function hasHead(root: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])).ok
}

export async function readTextFile(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_TEXT_BYTES) return null
    const text = (await readFile(path)).toString('utf8')
    return text.includes('\0') ? null : text
  } catch {
    return null
  }
}

async function countUntracked(root: string, files: GitFileEntry[]): Promise<GitFileEntry[]> {
  return Promise.all(
    files.map(async (file) => {
      if (!file.untracked) return file
      const text = await readTextFile(join(root, file.path))
      if (text === null) return file
      const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      return { ...file, added: lines, removed: 0 }
    })
  )
}

export async function repoStatus(folder: unknown): Promise<RepoStatusResult> {
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  const status = await git(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
  if (!status.ok) return { ok: false, error: status.message }
  const info = parseStatusV2(status.stdout)
  const base = (await hasHead(root)) ? ['diff', 'HEAD'] : ['diff', '--cached']
  const numstat = await git(root, [...base, '--numstat', '-z'])
  const counted = withCounts(info.files, numstat.ok ? parseNumstatZ(numstat.stdout) : [])
  return { ok: true, status: { ...info, files: await countUntracked(root, counted), root } }
}

function failure(error: string, committed?: string): GitCommitResult {
  return committed ? { ok: false, error, committed } : { ok: false, error }
}

export const commitFiles = (request: CommitRequest): Promise<GitCommitResult> =>
  whileLocked(request?.folder, () => commitNow(request)) as Promise<GitCommitResult>

async function commitNow(request: CommitRequest): Promise<GitCommitResult> {
  const checked = validateRepoPaths(request?.paths)
  if (!checked.ok) return failure(checked.error)
  const message = typeof request.message === 'string' ? request.message.trim() : ''
  if (message === '') return failure('Enter a commit message.')
  const current = await repoStatus(request.folder)
  if (!current.ok) return failure(current.error)
  const known = new Set(current.status.files.map((file) => file.path))
  const missing = checked.paths.find((path) => !known.has(path))
  if (missing) return failure(`${missing} has no changes to commit.`)
  const paths = expandRenames(current.status.files, checked.paths)
  const root = current.status.root
  const staged = await git(root, ['add', '-A', '--', ...paths])
  if (!staged.ok) return failure(staged.message)
  const committed = await git(root, ['commit', '-m', message, '--', ...paths], SLOW_MS)
  forgetChanges()
  if (!committed.ok) return failure(committed.message)
  const hash = (await git(root, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
  if (!request.push) return { ok: true, hash, pushed: false }
  const pushed = await git(root, ['push'], SLOW_MS)
  forgetChanges()
  return pushed.ok ? { ok: true, hash, pushed: true } : failure(`Committed ${hash}, but the push failed.\n${pushed.message}`, hash)
}

export const pushBranch = (folder: unknown): Promise<GitResult> => whileLocked(folder, () => pushNow(folder))

async function pushNow(folder: unknown): Promise<GitResult> {
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  const pushed = await git(root, ['push'], SLOW_MS)
  return pushed.ok ? { ok: true } : { ok: false, error: pushed.message }
}

export function insideRoot(root: string, path: string): string | null {
  const full = resolve(root, path)
  const rel = relative(resolve(root), full)
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : full
}

export const discardFiles = (request: DiscardRequest): Promise<GitResult> => whileLocked(request?.folder, () => discardNow(request))

async function discardNow(request: DiscardRequest): Promise<GitResult> {
  const checked = validateRepoPaths(request?.paths)
  if (!checked.ok) return { ok: false, error: checked.error }
  const current = await repoStatus(request.folder)
  if (!current.ok) return { ok: false, error: current.error }
  const byPath = new Map(current.status.files.map((file) => [file.path, file]))
  const entries: GitFileEntry[] = []
  for (const path of checked.paths) {
    const entry = byPath.get(path)
    if (!entry) return { ok: false, error: `${path} has no changes to discard.` }
    entries.push(entry)
  }
  const root = current.status.root
  const untracked = entries.filter((entry) => entry.untracked)
  const added = entries.filter((entry) => !entry.untracked && (entry.index === 'A' || entry.index === 'R' || entry.index === 'C'))
  const restore = entries.filter((entry) => !entry.untracked && !added.includes(entry)).map((entry) => entry.path)
  for (const entry of added) if (entry.origPath && entry.index === 'R') restore.push(entry.origPath)
  const doomed: string[] = []
  for (const entry of untracked) {
    const full = insideRoot(root, entry.path)
    if (!full) return { ok: false, error: `Path is outside the repository: ${entry.path}` }
    doomed.push(full)
  }
  if (added.length > 0) {
    const removed = await git(root, ['rm', '-f', '-q', '--', ...added.map((entry) => entry.path)])
    if (!removed.ok) return { ok: false, error: removed.message }
  }
  if (restore.length > 0) {
    const restored = await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...restore])
    if (!restored.ok) return { ok: false, error: restored.message }
  }
  try {
    for (const full of doomed) await rm(full, { recursive: true, force: true })
  } catch (error) {
    forgetChanges()
    return { ok: false, error: `Could not delete an untracked file: ${(error as Error).message}` }
  }
  forgetChanges()
  return { ok: true }
}

// A whole new file as a unified diff, so the viewer draws it like any other change.
export function asAddedDiff(path: string, text: string): string {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return [`--- /dev/null`, `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n')
}

export async function fileDiff(folder: unknown, path: unknown): Promise<GitDiffResult> {
  const checked = validateRepoPaths([path])
  if (!checked.ok) return { ok: false, error: checked.error }
  const current = await repoStatus(folder)
  if (!current.ok) return { ok: false, error: current.error }
  const entry = current.status.files.find((file) => file.path === checked.paths[0])
  if (!entry) return { ok: true, text: '' }
  const root = current.status.root
  if (entry.untracked) {
    const text = await readTextFile(join(root, entry.path))
    return { ok: true, text: text === null ? `Binary or large file: ${entry.path}` : asAddedDiff(entry.path, text) }
  }
  const base = (await hasHead(root)) ? ['diff', 'HEAD'] : ['diff', '--cached']
  const paths = entry.origPath ? [entry.origPath, entry.path] : [entry.path]
  const diff = await git(root, [...base, '--no-color', '-M', '--', ...paths])
  if (!diff.ok) return { ok: false, error: diff.message }
  const text = diff.stdout.length > MAX_DIFF_CHARS ? `${diff.stdout.slice(0, MAX_DIFF_CHARS)}\n… diff truncated` : diff.stdout
  return { ok: true, text }
}
