import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validCheckpointRef } from '../shared/checkpoints'
import type { TurnFileDiffResult, TurnFileInfo } from '../shared/turnApi'
import { normalizeRestorePaths } from './checkpointPaths'
import { asAddedDiff, git, insideRoot, readTextFile, repoRoot } from './gitCommit'

const MAX_FILES = 200

async function modified(full: string): Promise<{ mtimeMs: number; link: boolean } | null> {
  try {
    const info = await lstat(full)
    return { mtimeMs: info.mtimeMs, link: info.isSymbolicLink() }
  } catch {
    return null
  }
}

function asRemovedDiff(path: string, text: string): string {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return [`--- a/${path}`, '+++ /dev/null', `@@ -1,${lines.length} +0,0 @@`, ...lines.map((line) => `-${line}`)].join('\n')
}

async function betweenTexts(root: string, before: string, full: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dawsha-turn-'))
  try {
    const old = join(dir, 'before')
    await writeFile(old, before, 'utf8')
    // Exit status 1 only says the files differ; the diff is on stdout either way.
    return (await git(root, ['diff', '--no-index', '--no-color', '-U3', '--', old, full], 15_000, false)).stdout
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** One file as the reply's checkpoint held it, compared with the file now. */
export async function turnFileDiff(folder: unknown, sessionId: unknown, ref: unknown, path: unknown): Promise<TurnFileDiffResult> {
  if (!validCheckpointRef(sessionId, ref)) return { ok: false, error: 'Invalid checkpoint.' }
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  const checked = normalizeRestorePaths(root, [path])
  if (!checked.ok) return { ok: false, error: checked.error }
  const file = checked.paths[0]
  const full = insideRoot(root, file)
  if (!full) return { ok: false, error: 'That file is outside the repository.' }
  if (!(await git(root, ['show-ref', '--verify', '--quiet', ref])).ok) return { ok: false, error: 'Checkpoint no longer exists.' }
  const info = await modified(full)
  if (info?.link) return { ok: true, text: '', mtimeMs: info.mtimeMs, gone: false }
  const now = info ? await readTextFile(full) : null
  const held = await git(root, ['show', `${ref}:${file}`])
  const mtimeMs = info?.mtimeMs ?? null
  if (!held.ok) return { ok: true, text: now === null ? '' : asAddedDiff(file, now), mtimeMs, gone: false }
  if (!info) return { ok: true, text: asRemovedDiff(file, held.stdout), mtimeMs, gone: true }
  if (now === null) return { ok: true, text: '', mtimeMs, gone: false }
  return { ok: true, text: await betweenTexts(root, held.stdout, full), mtimeMs, gone: false }
}

/** Each path as a repository path with its last-saved time; a path outside the repository is left out. */
export async function inspectFiles(folder: unknown, paths: unknown): Promise<Record<string, TurnFileInfo>> {
  const root = await repoRoot(folder)
  if (!root || !Array.isArray(paths)) return {}
  const out: Record<string, TurnFileInfo> = {}
  for (const path of paths.slice(0, MAX_FILES)) {
    const checked = normalizeRestorePaths(root, [path])
    const full = checked.ok ? insideRoot(root, checked.paths[0]) : null
    if (typeof path === 'string' && checked.ok && full) out[path] = { rel: checked.paths[0], mtimeMs: (await modified(full))?.mtimeMs ?? null }
  }
  return out
}
