import { resolve } from 'node:path'
import {
  conflictText,
  isOwnBranch,
  isOwnWorktree,
  mergeRefusal,
  numstatRows,
  parseConflictFiles,
  type MergeBackRequest,
  type MergeOverview,
  type MergeOverviewResult,
  type MergeResult,
  type WorktreeCommitRequest,
  type WorktreeRemoveRequest
} from '../shared/mergeBack'
import type { GitCommitResult } from '../shared/gitStatus'
import type { GitResult } from '../shared/types'
import { removeWorktree } from './compare'
import { forgetChanges } from './git'
import { REPO_BUSY, commitFiles, git, repoStatus, tryLockRepo, unlockRepo } from './gitCommit'

const MERGE_MS = 120_000

interface Verified {
  main: string
  path: string
  branch: string
}

type Check = { ok: true; value: Verified } | { ok: false; error: string }

const same = (a: string, b: string): boolean => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b))
const text = (value: unknown): value is string => typeof value === 'string' && value !== '' && !value.includes('\0')
const lines = (out: string): string[] => out.split('\n').filter((line) => line.trim() !== '')

/** The request must name a linked worktree Dawsha made, registered with the repository; the renderer's strings are never trusted. */
async function verify(request: unknown): Promise<Check> {
  const { repo, path } = (request ?? {}) as Partial<MergeBackRequest>
  if (!text(repo) || !text(path)) return { ok: false, error: 'Merge back needs a repository and a worktree.' }
  const listed = await git(repo, ['worktree', 'list', '--porcelain', '-z'])
  if (!listed.ok) return { ok: false, error: 'The project is not a git repository.' }
  const trees = listed.stdout.split('\0').filter((field) => field.startsWith('worktree ')).map((field) => field.slice('worktree '.length))
  const [main, ...linked] = trees
  if (!main || !linked.some((tree) => same(tree, path))) return { ok: false, error: 'That worktree is gone or is not part of this project.' }
  if (!isOwnWorktree(path)) return { ok: false, error: 'Dawsha only merges worktrees it created for a preset or a comparison.' }
  const head = await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = head.stdout.trim()
  if (!head.ok || !isOwnBranch(branch)) return { ok: false, error: 'The worktree is not on a branch Dawsha created.' }
  return { ok: true, value: { main, path, branch } }
}

async function dirtyCount(folder: string, untracked: boolean): Promise<number> {
  const out = await git(folder, ['status', '--porcelain', untracked ? '--untracked-files=all' : '--untracked-files=no'])
  return out.ok ? lines(out.stdout).length : 0
}

async function baseBranchOf(main: string): Promise<string | null> {
  const head = await git(main, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const name = head.stdout.trim()
  return head.ok && name !== '' && name !== 'HEAD' ? name : null
}

async function readOverview(found: Verified): Promise<MergeOverview> {
  const baseBranch = await baseBranchOf(found.main)
  const base = baseBranch ?? 'HEAD'
  const [ahead, numstat, subject, worktreeDirtyFiles, baseDirtyFiles] = await Promise.all([
    git(found.main, ['rev-list', '--count', `${base}..${found.branch}`]),
    git(found.main, ['diff', '--numstat', '-z', `${base}...${found.branch}`]),
    git(found.main, ['log', '-1', '--format=%s', found.branch]),
    dirtyCount(found.path, true),
    dirtyCount(found.main, false)
  ])
  return {
    branch: found.branch,
    baseBranch,
    ahead: ahead.ok ? Number.parseInt(ahead.stdout, 10) || 0 : 0,
    files: numstat.ok ? numstatRows(numstat.stdout) : [],
    worktreeDirtyFiles,
    baseDirtyFiles,
    lastSubject: subject.stdout.trim()
  }
}

export async function mergeOverview(request: unknown): Promise<MergeOverviewResult> {
  const checked = await verify(request)
  return checked.ok ? { ok: true, ...(await readOverview(checked.value)) } : checked
}

export async function commitWorktree(request: unknown): Promise<GitCommitResult> {
  const checked = await verify(request)
  if (!checked.ok) return checked
  const message = (request as WorktreeCommitRequest).message
  const status = await repoStatus(checked.value.path)
  if (!status.ok) return status
  const paths = status.status.files.map((file) => file.path)
  if (paths.length === 0) return { ok: false, error: 'The worktree has no uncommitted files.' }
  return commitFiles({ folder: checked.value.path, paths, message: typeof message === 'string' ? message : '', push: false })
}

async function abortMerge(main: string, base: string): Promise<MergeResult> {
  const conflicted = await git(main, ['diff', '--name-only', '--diff-filter=U'])
  const conflicts = conflicted.ok ? parseConflictFiles(conflicted.stdout) : []
  const merging = await git(main, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (merging.ok) await git(main, ['merge', '--abort'])
  forgetChanges()
  if (conflicts.length > 0) return { ok: false, error: conflictText(base, conflicts), conflicts }
  return { ok: false, error: 'git could not merge the branch.' }
}

async function mergeLocked(found: Verified): Promise<MergeResult> {
  const overview = await readOverview(found)
  const refusal = mergeRefusal(overview)
  const base = overview.baseBranch
  if (refusal || base === null) return { ok: false, error: refusal ?? 'There is no branch to merge into.' }
  const message = `Merge branch '${found.branch}' into ${base}`
  const merged = await git(found.main, ['merge', '--no-ff', '--no-edit', '-m', message, found.branch], MERGE_MS)
  forgetChanges()
  if (merged.ok) return { ok: true, message: `Merged ${found.branch} into ${base}.` }
  const aborted = await abortMerge(found.main, base)
  return !aborted.ok && !aborted.conflicts ? { ok: false, error: merged.message || aborted.error } : aborted
}

/** `git merge --no-ff` of the worktree's branch in the main folder. A conflict aborts the merge and names the files. */
export async function mergeBranch(request: unknown): Promise<MergeResult> {
  const checked = await verify(request)
  if (!checked.ok) return checked
  if (!tryLockRepo(checked.value.main)) return { ok: false, error: REPO_BUSY }
  try {
    return await mergeLocked(checked.value)
  } finally {
    unlockRepo(checked.value.main)
  }
}

export async function removeSessionWorktree(request: unknown): Promise<GitResult> {
  const checked = await verify(request)
  if (!checked.ok) return checked
  const { main, path, branch } = checked.value
  return removeWorktree({ repo: main, path, branch, force: (request as WorktreeRemoveRequest).force === true })
}
