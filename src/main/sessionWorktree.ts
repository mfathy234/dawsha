import { existsSync } from 'node:fs'
import { isShortId } from '../shared/compare'
import { presetWorktreeNames, type SessionWorktreeResult } from '../shared/mergeBack'
import { git, repoRoot } from './gitCommit'

const SLOW_MS = 60_000

/** A new worktree, on its own new branch from the folder's current HEAD, for one preset session. */
export async function createSessionWorktree(folder: unknown, short: unknown): Promise<SessionWorktreeResult> {
  if (typeof short !== 'string' || !isShortId(short)) return { ok: false, error: 'The worktree id is not valid.' }
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This project is not a git repository, so it cannot get its own worktree.' }
  const head = await git(root, ['rev-parse', '--verify', 'HEAD'])
  if (!head.ok) return { ok: false, error: 'This repository has no commits yet, so a worktree cannot start from HEAD.' }
  const names = presetWorktreeNames(root, short)
  if (existsSync(names.path)) return { ok: false, error: `The folder ${names.path} already exists. Try again.` }
  const added = await git(root, ['worktree', 'add', '-b', names.branch, names.path, 'HEAD'], SLOW_MS)
  return added.ok ? { ok: true, ...names } : { ok: false, error: added.message || `git could not create ${names.path}.` }
}
