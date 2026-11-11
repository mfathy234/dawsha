import { existsSync } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  leftoverWorktrees,
  parseWorktreeList,
  samePath,
  type CleanupCandidate,
  type CleanupFailure,
  type CleanupItem,
  type CleanupListResult,
  type CleanupResult,
  type ListedWorktree
} from '../shared/worktreeCleanup'
import { removeWorktreeFolder } from './compare'
import { REPO_BUSY, git, tryLockRepo, unlockRepo } from './gitCommit'

const MAX_ENTRIES = 150_000
const MAX_ITEMS = 200
const MAX_OPEN = 1000

const text = (value: unknown): value is string => typeof value === 'string' && value !== '' && !value.includes('\0')

interface Size {
  bytes: number
  capped: boolean
}

/** Bytes used by the files under a folder. Links are not followed; a very large tree is counted only up to a limit. */
export async function folderSize(root: string): Promise<Size> {
  let bytes = 0
  let seen = 0
  const pending = [root]
  while (pending.length > 0) {
    const dir = pending.pop() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      seen += 1
      if (seen > MAX_ENTRIES) return { bytes, capped: true }
      const full = join(dir, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile()) bytes += await lstat(full).then((info) => info.size, () => 0)
    }
  }
  return { bytes, capped: false }
}

async function readTrees(folder: string): Promise<{ ok: true; trees: ListedWorktree[] } | { ok: false; error: string }> {
  const listed = await git(folder, ['worktree', 'list', '--porcelain', '-z'])
  if (!listed.ok) return { ok: false, error: 'This project is not a git repository.' }
  return { ok: true, trees: parseWorktreeList(listed.stdout) }
}

const openList = (value: unknown): string[] => (Array.isArray(value) ? value.filter(text).slice(0, MAX_OPEN) : [])

/** The branch the main checkout is on, or HEAD while it is detached: what "merged" is measured against. */
async function baseOf(main: string): Promise<string> {
  const head = await git(main, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const name = head.stdout.trim()
  return head.ok && name !== '' && name !== 'HEAD' ? name : 'HEAD'
}

async function isMerged(main: string, branch: string, base: string): Promise<boolean> {
  return (await git(main, ['merge-base', '--is-ancestor', branch, base])).ok
}

async function dirtyFiles(path: string): Promise<number> {
  const out = await git(path, ['status', '--porcelain', '--untracked-files=all'])
  return out.ok ? out.stdout.split('\n').filter((line) => line.trim() !== '').length : 0
}

async function createdAt(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs
  } catch {
    return Date.now()
  }
}

async function describe(main: string, base: string, tree: ListedWorktree): Promise<CleanupCandidate> {
  const branch = tree.branch as string
  const [merged, dirty, size, born] = await Promise.all([isMerged(main, branch, base), dirtyFiles(tree.path), folderSize(tree.path), createdAt(tree.path)])
  return { path: tree.path, branch, merged, sizeBytes: size.bytes, sizeCapped: size.capped, createdAt: born, dirtyFiles: dirty }
}

/** The worktrees Dawsha made for sessions that are now closed, with branch state, size, age and uncommitted files. */
export async function listCleanup(folder: unknown, openPaths: unknown): Promise<CleanupListResult> {
  if (!text(folder)) return { ok: false, error: 'Choose a project first.' }
  const read = await readTrees(folder)
  if (!read.ok) return read
  const left = leftoverWorktrees(read.trees, openList(openPaths)).filter((tree) => existsSync(tree.path))
  const main = read.trees[0]?.path
  if (!main) return { ok: true, candidates: [] }
  const base = await baseOf(main)
  const candidates = await Promise.all(left.map((tree) => describe(main, base, tree)))
  return { ok: true, candidates }
}

/** How many leftover worktrees a project has; cheap, for the notice. */
export async function countCleanup(folder: unknown, openPaths: unknown): Promise<number> {
  if (!text(folder)) return 0
  const read = await readTrees(folder)
  return read.ok ? leftoverWorktrees(read.trees, openList(openPaths)).filter((tree) => existsSync(tree.path)).length : 0
}

function validItems(value: unknown): CleanupItem[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_ITEMS)
    .filter((item): item is CleanupItem => !!item && text(item.path) && text(item.branch))
    .map((item) => ({ path: item.path, branch: item.branch, force: item.force === true, deleteBranch: item.deleteBranch === true }))
}

async function removeOne(main: string, base: string, item: CleanupItem): Promise<{ failure?: CleanupFailure; branchDeleted?: string }> {
  const problem = await removeWorktreeFolder(main, item.path, item.force)
  if (problem) return { failure: { path: item.path, error: problem } }
  await git(main, ['worktree', 'prune'])
  if (!item.deleteBranch || !(await isMerged(main, item.branch, base))) return {}
  const deleted = await git(main, ['branch', '-d', item.branch])
  return deleted.ok ? { branchDeleted: item.branch } : { failure: { path: item.path, error: `The folder is gone, but git kept ${item.branch}: ${deleted.message}` } }
}

async function runLocked(main: string, trees: ListedWorktree[], items: CleanupItem[], open: string[]): Promise<CleanupResult> {
  const allowed = leftoverWorktrees(trees, open)
  const base = await baseOf(main)
  const removed: string[] = []
  const branchesDeleted: string[] = []
  const failed: CleanupFailure[] = []
  for (const item of items) {
    const tree = allowed.find((candidate) => samePath(candidate.path, item.path))
    if (!tree || tree.branch !== item.branch) {
      failed.push({ path: item.path, error: 'That worktree is gone, still in use, or was not made by Dawsha for a session.' })
      continue
    }
    const done = await removeOne(main, base, { ...item, path: tree.path })
    if (done.branchDeleted) branchesDeleted.push(done.branchDeleted)
    if (done.failure) failed.push(done.failure)
    if (!existsSync(tree.path)) removed.push(item.path)
  }
  return { ok: true, removed, branchesDeleted, failed }
}

/** Removes the chosen worktrees with `git worktree remove` (forced only when the item says so) and deletes merged branches on request. Every item is checked again against git's own list. */
export async function runCleanup(request: unknown): Promise<CleanupResult> {
  const { repo, openPaths, items } = (request ?? {}) as Record<string, unknown>
  const chosen = validItems(items)
  if (!text(repo) || chosen.length === 0) return { ok: false, error: 'Choose at least one worktree to remove.' }
  const read = await readTrees(repo)
  if (!read.ok) return read
  const main = read.trees[0]?.path
  if (!main) return { ok: false, error: 'This project is not a git repository.' }
  if (!tryLockRepo(main)) return { ok: false, error: REPO_BUSY }
  try {
    return await runLocked(main, read.trees, chosen, openList(openPaths))
  } finally {
    unlockRepo(main)
  }
}
