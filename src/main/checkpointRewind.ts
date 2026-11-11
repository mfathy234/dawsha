import { realpathSync } from 'node:fs'
import { lstat, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { validCheckpointRef } from '../shared/checkpoints'
import { changedSince, type RewindFileInfo } from '../shared/rewind'
import { normalizeRestorePaths } from './checkpointPaths'
import { run, withTempIndex } from './checkpoints'
import { git, repoRoot } from './gitCommit'

export type RewindInfoResult = { ok: true; files: RewindFileInfo[] } | { ok: false; error: string }
export type ToWorktreeResult = { ok: true; files: number } | { ok: false; error: string }

const MAX_FILES = 200
const CHUNK = 100

interface Wanted {
  /** The path as the caller named it; the answer is keyed by it. */
  original: string
  path: string
  touchedAt?: number
}

/** The files that lie inside the repository. One outside it (a plan file, say) is left out, not a reason to refuse the rest. */
function parseWanted(root: string, value: unknown): Wanted[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FILES) return null
  const out: Wanted[] = []
  for (const entry of value) {
    const raw = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null
    if (typeof raw?.path !== 'string') return null
    const clean = normalizeRestorePaths(root, [raw.path])
    if (!clean.ok) continue
    const touchedAt = typeof raw.touchedAt === 'number' && Number.isFinite(raw.touchedAt) ? raw.touchedAt : undefined
    out.push({ original: raw.path, path: clean.paths[0], ...(touchedAt !== undefined ? { touchedAt } : {}) })
  }
  return out.length ? out : null
}

const mtimeOf = (root: string, path: string): Promise<number | null> => lstat(join(root, path)).then((info) => info.mtimeMs, () => null)

/** For each file, whether the snapshot holds it (else the agent created it) and whether someone changed it after the reply that touched it. */
export async function rewindInfo(folder: unknown, sessionId: unknown, ref: unknown, files: unknown): Promise<RewindInfoResult> {
  if (typeof sessionId !== 'string' || !validCheckpointRef(sessionId, ref)) return { ok: false, error: 'Invalid checkpoint.' }
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  const wanted = parseWanted(root, files)
  if (!wanted) return { ok: false, error: 'No files to check.' }
  if (!(await git(root, ['show-ref', '--verify', '--quiet', ref])).ok) return { ok: false, error: 'Checkpoint no longer exists.' }
  try {
    const held = new Set((await run(root, ['ls-tree', '-r', '-z', '--name-only', ref, '--', ...wanted.map((item) => item.path)])).split('\0').filter(Boolean))
    const infos = await Promise.all(wanted.map(async (item): Promise<RewindFileInfo> => ({ path: item.original, isNew: !held.has(item.path), changedSince: changedSince(await mtimeOf(root, item.path), item.touchedAt) })))
    return { ok: true, files: infos }
  } catch (error) {
    return { ok: false, error: `Could not check the files: ${(error as Error).message}` }
  }
}

const samePath = (a: string, b: string): boolean => {
  const real = (path: string): string => {
    try { return realpathSync.native(path) } catch { return resolve(path) }
  }
  const clean = (path: string): string => real(path).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? clean(a).toLowerCase() === clean(b).toLowerCase() : clean(a) === clean(b)
}

async function isOtherWorktree(root: string, path: string): Promise<boolean> {
  const listed = await git(root, ['worktree', 'list', '--porcelain'])
  if (!listed.ok) return false
  const paths = listed.stdout.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))
  return !samePath(root, path) && paths.some((entry) => samePath(entry, path))
}

/** Splits `git diff-tree -z --name-status` output into paths to write and paths to delete. */
export function parseTreeDiff(text: string): { write: string[]; remove: string[] } {
  const parts = text.split('\0').filter((part) => part !== '')
  const write: string[] = []
  const remove: string[] = []
  for (let index = 0; index + 1 < parts.length; index += 2) (parts[index].startsWith('D') ? remove : write).push(parts[index + 1])
  return { write, remove }
}

/** Makes a worktree's files match a checkpoint: what differs between its HEAD and the snapshot is written or deleted there. Nothing outside that worktree is touched. */
export async function applyCheckpointToWorktree(folder: unknown, sessionId: unknown, ref: unknown, worktree: unknown): Promise<ToWorktreeResult> {
  if (typeof sessionId !== 'string' || !validCheckpointRef(sessionId, ref)) return { ok: false, error: 'Invalid checkpoint.' }
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  if (typeof worktree !== 'string' || !(await isOtherWorktree(root, worktree))) return { ok: false, error: 'That is not a worktree of this project.' }
  if (!(await git(root, ['show-ref', '--verify', '--quiet', ref])).ok) return { ok: false, error: 'Checkpoint no longer exists.' }
  try {
    const { write, remove } = parseTreeDiff(await run(worktree, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', 'HEAD', ref]))
    const clean = (paths: string[]): ReturnType<typeof normalizeRestorePaths> => (paths.length ? normalizeRestorePaths(worktree, paths) : { ok: true, paths: [] })
    const writing = clean(write)
    const removing = clean(remove)
    if (!writing.ok || !removing.ok) return { ok: false, error: 'The snapshot holds a path that cannot be restored.' }
    const toWrite = writing.paths
    const toRemove = removing.paths
    if (toWrite.length) await withTempIndex(async (index) => {
      await run(worktree, ['read-tree', ref], index)
      for (let at = 0; at < toWrite.length; at += CHUNK) await run(worktree, ['checkout-index', '--force', '--', ...toWrite.slice(at, at + CHUNK)], index)
    })
    for (const path of toRemove) await rm(join(worktree, path), { force: true })
    return { ok: true, files: toWrite.length + toRemove.length }
  } catch (error) {
    return { ok: false, error: `Could not copy the files: ${(error as Error).message}` }
  }
}
