import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { sanitizePendingWorktrees, type PendingSetupLaunch, type PendingWorktreeSetup } from '../shared/terminalSetup'

const pending = new Map<string, PendingWorktreeSetup>()
const claimed = new Set<string>()
let save: (entries: PendingWorktreeSetup[]) => void = () => undefined

export function configurePendingWorktrees(initial: unknown, persist: (entries: PendingWorktreeSetup[]) => void): void {
  pending.clear()
  claimed.clear()
  for (const entry of sanitizePendingWorktrees(initial)) pending.set(key(entry.path), entry)
  save = persist
}

function persist(): void { save([...pending.values()]) }

function key(folder: string): string {
  let full: string
  try { full = realpathSync.native(folder) } catch { full = resolve(folder) }
  return process.platform === 'win32' ? full.toLowerCase() : full
}

/** Registered only by trusted worktree creation after local files have been copied. */
export function registerPendingWorktree(folder: string, repo: string): void {
  pending.set(key(folder), { path: folder, repo })
  claimed.delete(key(folder))
  persist()
}

export function claimPendingWorktree(folder: string): PendingWorktreeSetup | null {
  const id = key(folder)
  if (claimed.has(id)) return null
  const entry = pending.get(id)
  if (entry) claimed.add(id)
  return entry ?? null
}

export function rememberPendingLaunch(folder: string, launch: PendingSetupLaunch): void {
  const id = key(folder)
  const entry = pending.get(id)
  if (entry) {
    pending.set(id, { ...entry, launch })
    persist()
  }
}

export function releasePendingWorktree(folder: string): void { claimed.delete(key(folder)) }

export function hasPendingWorktree(folder: string): boolean { return pending.has(key(folder)) }

export function completePendingWorktree(folder: string): void {
  const id = key(folder)
  pending.delete(id)
  claimed.delete(id)
  persist()
}
