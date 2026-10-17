import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { compareNames, isCompareBranch, isCompareWorktree, isShortId } from '../shared/compare'
import type { WorktreeStatus } from '../shared/compare'
import type { GitResult, RepoProbe, WorktreeRemoval, WorktreesResult } from '../shared/types'

const GIT_TIMEOUT_MS = 20_000
const REMOVE_ATTEMPTS = 6
const REMOVE_RETRY_MS = 300
const LOCKED = /permission denied|being used by another process|directory not empty|resource busy/i

export interface GitRun {
  ok: boolean
  stdout: string
  stderr: string
}

export function git(args: string[], cwd: string): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout.trim(), stderr: (stderr || (error?.message ?? '')).trim() })
    })
  })
}

const gitError = (run: GitRun, fallback: string): string => run.stderr || fallback

export async function probeRepo(folder: string): Promise<RepoProbe> {
  const inside = await git(['rev-parse', '--is-inside-work-tree'], folder)
  if (!inside.ok || inside.stdout !== 'true') return { isRepo: false, hasCommits: false, branch: null }
  const head = await git(['rev-parse', '--verify', 'HEAD'], folder)
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], folder)
  return { isRepo: true, hasCommits: head.ok, branch: branch.ok ? branch.stdout : null }
}

async function addWorktree(repo: string, path: string, branch: string): Promise<GitResult> {
  const run = await git(['worktree', 'add', '-b', branch, path, 'HEAD'], repo)
  return run.ok ? { ok: true } : { ok: false, error: gitError(run, `git could not create ${path}.`) }
}

export async function createWorktrees(repo: string, short: string): Promise<WorktreesResult> {
  if (!isShortId(short)) return { ok: false, error: 'The compare id is not valid.' }
  const sides = compareNames(repo, short)
  for (const side of [sides.a, sides.b]) {
    if (existsSync(side.path)) return { ok: false, error: `The folder ${side.path} already exists. Try again.` }
  }
  const first = await addWorktree(repo, sides.a.path, sides.a.branch)
  if (!first.ok) return first
  const second = await addWorktree(repo, sides.b.path, sides.b.branch)
  if (!second.ok) {
    await removeWorktree({ repo, path: sides.a.path, branch: sides.a.branch, force: true })
    return second
  }
  return { ok: true, sides }
}

export async function worktreeStatus(repo: string, path: string, branch: string): Promise<WorktreeStatus> {
  if (!isCompareBranch(branch) || !existsSync(path)) return { exists: false, dirtyFiles: 0, commits: 0 }
  const dirty = await git(['status', '--porcelain'], path)
  const ahead = await git(['rev-list', '--count', `HEAD..${branch}`], repo)
  const commits = ahead.ok ? Number.parseInt(ahead.stdout, 10) : 0
  return {
    exists: true,
    dirtyFiles: dirty.ok && dirty.stdout !== '' ? dirty.stdout.split('\n').length : 0,
    commits: Number.isFinite(commits) ? commits : 0
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function removeWorktreeFolder(repo: string, path: string, force: boolean | undefined): Promise<string | null> {
  for (let attempt = 1; ; attempt += 1) {
    const removed = await git(['worktree', 'remove', ...(force ? ['--force'] : []), path], repo)
    if (removed.ok || !existsSync(path)) return null
    if (/is not a working tree/i.test(removed.stderr)) return deleteLeftover(path)
    if (!LOCKED.test(removed.stderr) || attempt >= REMOVE_ATTEMPTS) return gitError(removed, `git could not remove ${path}.`)
    await pause(REMOVE_RETRY_MS * attempt)
  }
}

function deleteLeftover(path: string): string | null {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: REMOVE_ATTEMPTS, retryDelay: REMOVE_RETRY_MS })
    return null
  } catch (error) {
    return `Could not delete ${path}: ${(error as Error).message}`
  }
}

export async function removeWorktree(request: WorktreeRemoval): Promise<GitResult> {
  const { repo, path, branch, force } = request
  if (!isCompareBranch(branch) || !isCompareWorktree(path)) {
    return { ok: false, error: 'Dawsha only removes worktrees and branches it created for a comparison.' }
  }
  if (existsSync(path)) {
    const problem = await removeWorktreeFolder(repo, path, force)
    if (problem) return { ok: false, error: problem }
  }
  await git(['worktree', 'prune'], repo)
  const deleted = await git(['branch', force ? '-D' : '-d', branch], repo)
  if (!deleted.ok && !/not found/i.test(deleted.stderr)) return { ok: false, error: gitError(deleted, `git could not delete ${branch}.`) }
  return { ok: true }
}
