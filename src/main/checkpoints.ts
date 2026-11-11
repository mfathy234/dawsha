import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { checkpointPrefix, checkpointRef, MAX_SESSION_CHECKPOINTS, MAX_SESSION_UNDOS, nextUndoNumber, refsToPrune, undoPrefix, undoRef, validCheckpointRef, validUndoRef } from '../shared/checkpoints'
import { normalizeRestorePaths } from './checkpointPaths'
import { git, repoRoot } from './gitCommit'

const exec = promisify(execFile)
const PENDING_TTL_MS = 120_000
const SAMPLE_KEY = '0000000000000000'
const IDENTITY = { GIT_AUTHOR_NAME: 'Dawsha', GIT_AUTHOR_EMAIL: 'dawsha@localhost', GIT_COMMITTER_NAME: 'Dawsha', GIT_COMMITTER_EMAIL: 'dawsha@localhost' }

/** Runs git with literal pathspecs (check-ignore cannot take them); `index` points git at a throwaway index so the real one is never read or written. */
export const run = (cwd: string, args: string[], index?: string, literal = true): Promise<string> => exec('git', [...(literal ? ['--literal-pathspecs'] : []), '-c', 'core.quotepath=false', ...args], {
  cwd, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, ...IDENTITY, GIT_TERMINAL_PROMPT: '0', ...(index ? { GIT_INDEX_FILE: index } : {}) }
}).then(({ stdout }) => stdout)

interface Pending { root: string; commit: string; takenAt: number }
const pending = new Map<string, Pending>()

export const checkpointKey = (messageId: string): string => createHash('sha1').update(messageId).digest('hex').slice(0, 16)

export async function withTempIndex<T>(work: (index: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'dawsha-checkpoint-'))
  try {
    return await work(join(dir, 'index'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Commits the whole working tree (tracked and untracked, not ignored) through a throwaway index; HEAD, branches and the real index are not touched. */
async function snapshot(root: string, message: string): Promise<string> {
  return withTempIndex(async (index) => {
    const head = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])
    await run(root, head.ok ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], index)
    await run(root, ['add', '-A'], index)
    const tree = (await run(root, ['write-tree'], index)).trim()
    const args = ['commit-tree', tree, '-m', message, ...(head.ok ? ['-p', head.stdout.trim()] : [])]
    return (await run(root, args)).trim()
  })
}

async function refsUnder(root: string, prefix: string): Promise<string[]> {
  const result = await git(root, ['for-each-ref', '--sort=creatordate', '--format=%(refname)', prefix])
  return result.ok ? result.stdout.split(/\r?\n/).filter(Boolean) : []
}

async function prune(root: string, prefix: string, keep: number): Promise<void> {
  for (const old of refsToPrune(await refsUnder(root, prefix), keep)) await git(root, ['update-ref', '-d', old])
}

/** Takes the snapshot before a chat message is typed into the terminal and holds it for the session until the log shows that message. */
export async function prepareCheckpoint(folder: unknown, sessionId: unknown): Promise<boolean> {
  if (!checkpointRef(sessionId, SAMPLE_KEY)) return false
  const root = await repoRoot(folder)
  if (!root) return false
  try {
    pending.set(sessionId as string, { root, commit: await snapshot(root, 'Dawsha checkpoint'), takenAt: Date.now() })
    return true
  } catch (error) {
    console.error('Could not prepare Dawsha checkpoint:', error)
    return false
  }
}

/**
 * Files the session's pending snapshot under the user message it preceded. Null when there is none, it is stale,
 * or it was taken before the previous user message was seen: the message was typed in the terminal, the snapshot
 * would be late, and no Undo is offered for it.
 */
export async function storeCheckpoint(folder: unknown, sessionId: unknown, messageId: string, seenAfter: number): Promise<string | null> {
  const ref = checkpointRef(sessionId, checkpointKey(messageId))
  const held = typeof sessionId === 'string' ? pending.get(sessionId) : undefined
  if (!ref || !held) return null
  pending.delete(sessionId as string)
  if (Date.now() - held.takenAt > PENDING_TTL_MS || held.takenAt < seenAfter) return null
  const root = await repoRoot(folder)
  if (!root || root !== held.root) return null
  try {
    await run(root, ['update-ref', ref, held.commit])
    await prune(root, checkpointPrefix(sessionId as string), MAX_SESSION_CHECKPOINTS)
    return ref
  } catch (error) {
    console.error('Could not store Dawsha checkpoint:', error)
    return null
  }
}

/** The checkpoint ref of each given user message id that has one. */
export async function listCheckpoints(folder: unknown, sessionId: unknown, messageIds: unknown): Promise<Record<string, string>> {
  if (!checkpointRef(sessionId, SAMPLE_KEY) || !Array.isArray(messageIds)) return {}
  const root = await repoRoot(folder)
  if (!root) return {}
  const refs = new Set(await refsUnder(root, checkpointPrefix(sessionId as string)))
  const found: Record<string, string> = {}
  for (const id of messageIds.slice(0, 1000)) {
    const ref = typeof id === 'string' ? checkpointRef(sessionId, checkpointKey(id)) : null
    if (ref && refs.has(ref)) found[id as string] = ref
  }
  return found
}

async function saveUndoSnapshot(root: string, sessionId: string): Promise<string> {
  const ref = undoRef(sessionId, nextUndoNumber(await refsUnder(root, undoPrefix(sessionId)), sessionId))
  if (!ref) throw new Error('Invalid session.')
  await run(root, ['update-ref', ref, await snapshot(root, 'Dawsha undo snapshot')])
  await prune(root, undoPrefix(sessionId), MAX_SESSION_UNDOS)
  return ref
}

/** False when the file's folder resolves (through links) to somewhere outside the repository. */
async function underRoot(root: string, path: string): Promise<boolean> {
  try {
    const folder = relative(await realpath(root), await realpath(dirname(join(root, path))))
    return !folder.startsWith('..')
  } catch {
    return false
  }
}

const isIgnored = (root: string, path: string): Promise<boolean> => run(root, ['check-ignore', '-q', '--', path], undefined, false).then(() => true, () => false)

/** Deletes a file the reply created. Ignored files are skipped: the snapshot never held them, so absence proves nothing. */
async function removeCreated(root: string, path: string): Promise<boolean> {
  const info = await lstat(join(root, path)).catch(() => null)
  if (!info) return true
  if (info.isDirectory() || !(await underRoot(root, path)) || await isIgnored(root, path)) return false
  await rm(join(root, path), { force: true })
  return true
}

export type RestoreResult = { ok: true; beforeUndo: string | null; skipped: string[] } | { ok: false; error: string }

/**
 * Puts back only `paths`, the files one reply changed. A path the checkpoint holds is written from it through a
 * throwaway index; a path it lacks was created by the reply and is deleted. No other path is read or written.
 * Restoring from a "before undo" snapshot (redo) does not take another snapshot.
 */
export async function restoreCheckpoint(folder: unknown, sessionId: unknown, ref: unknown, paths: unknown): Promise<RestoreResult> {
  const isUndo = validUndoRef(sessionId, ref)
  if (typeof sessionId !== 'string' || typeof ref !== 'string' || (!isUndo && !validCheckpointRef(sessionId, ref))) return { ok: false, error: 'Invalid checkpoint.' }
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  const wanted = normalizeRestorePaths(root, paths)
  if (!wanted.ok) return wanted
  if (!(await git(root, ['show-ref', '--verify', '--quiet', ref])).ok) return { ok: false, error: 'Checkpoint no longer exists.' }
  try {
    const beforeUndo = isUndo ? null : await saveUndoSnapshot(root, sessionId)
    const inTree = new Set((await run(root, ['ls-tree', '-r', '-z', '--name-only', ref, '--', ...wanted.paths])).split('\0').filter(Boolean))
    const present = wanted.paths.filter((path) => inTree.has(path))
    if (present.length) await withTempIndex(async (index) => {
      await run(root, ['read-tree', ref], index)
      await run(root, ['checkout-index', '--force', '--', ...present], index)
    })
    const skipped: string[] = []
    for (const path of wanted.paths.filter((entry) => !inTree.has(entry))) if (!(await removeCreated(root, path))) skipped.push(path)
    return { ok: true, beforeUndo, skipped }
  } catch (error) {
    return { ok: false, error: `Could not restore the files: ${(error as Error).message}` }
  }
}
