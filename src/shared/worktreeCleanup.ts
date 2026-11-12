import { isOwnBranch, isOwnWorktree } from './mergeBack'
import { normalizePath } from './sessionMatch'

/** One entry of `git worktree list`. */
export interface ListedWorktree {
  path: string
  branch: string | null
}

/** A worktree Dawsha made for a session whose session is closed, with what the cleanup dialog shows about it. */
export interface CleanupCandidate {
  path: string
  branch: string
  /** The branch is contained in the branch the project has checked out. */
  merged: boolean
  sizeBytes: number
  /** The folder was too big to count in full, so the size is a lower bound. */
  sizeCapped: boolean
  createdAt: number
  dirtyFiles: number
}

export interface CleanupItem {
  path: string
  branch: string
  /** Remove even though the folder has uncommitted files, which are then lost. */
  force: boolean
  /** Also delete the branch, which is only done when it is merged. */
  deleteBranch: boolean
}

export interface CleanupRequest {
  repo: string
  /** Worktrees that still have an open session; they are never removed. */
  openPaths: string[]
  items: CleanupItem[]
}

export type CleanupListResult = { ok: true; candidates: CleanupCandidate[] } | { ok: false; error: string }

export interface CleanupFailure {
  path: string
  error: string
}

export type CleanupResult =
  | { ok: true; removed: string[]; branchesDeleted: string[]; failed: CleanupFailure[] }
  | { ok: false; error: string }

/** More leftover worktrees than this make the app offer a cleanup. */
export const NUDGE_OVER = 3

/** Reads `git worktree list --porcelain -z`: NUL-separated fields, one entry per `worktree` field. */
export function parseWorktreeList(stdout: string): ListedWorktree[] {
  const found: ListedWorktree[] = []
  for (const field of stdout.split('\0')) {
    if (field.startsWith('worktree ')) found.push({ path: field.slice('worktree '.length), branch: null })
    else if (field.startsWith('branch ') && found.length > 0) {
      const last = found[found.length - 1]
      found[found.length - 1] = { ...last, branch: field.slice('branch '.length).replace(/^refs\/heads\//, '') }
    }
  }
  return found
}

export const samePath = (a: string, b: string): boolean => normalizePath(a) === normalizePath(b)

/** The linked worktrees Dawsha made for sessions (never the main checkout, never one the user made) that no open session uses. */
export function leftoverWorktrees(listed: readonly ListedWorktree[], openPaths: readonly string[]): ListedWorktree[] {
  return listed
    .slice(1)
    .filter((tree) => tree.branch !== null && isOwnWorktree(tree.path) && isOwnBranch(tree.branch) && !openPaths.some((open) => samePath(open, tree.path)))
}

/** Rows start ticked, except those with uncommitted files. */
export const initialTicks = (candidates: readonly CleanupCandidate[]): ReadonlySet<string> =>
  new Set(candidates.filter((candidate) => candidate.dirtyFiles === 0).map((candidate) => candidate.path))

export function toggled(ticks: ReadonlySet<string>, path: string, on: boolean): ReadonlySet<string> {
  const next = new Set(ticks)
  if (on) next.add(path)
  else next.delete(path)
  return next
}

export interface CleanupPlan {
  items: CleanupItem[]
  /** Branches that would be deleted if the box is ticked: ticked rows whose branch is merged. */
  mergedBranches: string[]
  /** Uncommitted files that removing the ticked rows would lose. */
  lostFiles: number
}

export function cleanupPlan(candidates: readonly CleanupCandidate[], ticks: ReadonlySet<string>, deleteBranches: boolean): CleanupPlan {
  const chosen = candidates.filter((candidate) => ticks.has(candidate.path))
  return {
    items: chosen.map((candidate) => ({ path: candidate.path, branch: candidate.branch, force: candidate.dirtyFiles > 0, deleteBranch: deleteBranches && candidate.merged })),
    mergedBranches: chosen.filter((candidate) => candidate.merged).map((candidate) => candidate.branch),
    lostFiles: chosen.reduce((sum, candidate) => sum + candidate.dirtyFiles, 0)
  }
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

export const removeLabel = (count: number): string => `Remove ${plural(count, 'worktree', 'worktrees')}`

export const cleanupTitle = (project: string, count: number): string =>
  count > 0 ? `${removeLabel(count)} from closed sessions in ${project}?` : `Remove worktrees from closed sessions in ${project}?`

export const branchOptionLabel = (merged: readonly string[]): string =>
  merged.length > 0 ? `Also delete the merged branches (${merged.join(', ')})` : 'Also delete the merged branches'

export const uncommittedText = (count: number): string => plural(count, 'uncommitted file', 'uncommitted files')

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatSize(bytes: number, capped = false): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1)
  return `${text} ${UNITS[unit]}${capped ? '+' : ''}`
}

const DAY_MS = 86_400_000

export function formatAge(createdAt: number, now: number): string {
  const days = Math.floor(Math.max(0, now - createdAt) / DAY_MS)
  if (days < 1) return 'today'
  if (days < 60) return plural(days, 'day', 'days')
  return plural(Math.floor(days / 30), 'month', 'months')
}

/** "merged · 214 MB · 3 days" */
export function candidateDetail(candidate: CleanupCandidate, now: number): string {
  return [candidate.merged ? 'merged' : 'not merged', formatSize(candidate.sizeBytes, candidate.sizeCapped), formatAge(candidate.createdAt, now)].join(' · ')
}

/** Whether to show the "clean up" toast: only above the limit, and again only when more have piled up since the last offer. */
export const shouldOfferCleanup = (count: number, alreadyOffered: number): boolean => count > NUDGE_OVER && count > alreadyOffered

export const nudgeText = (project: string, count: number): string => `${project} has ${count} worktrees left from closed sessions.`
