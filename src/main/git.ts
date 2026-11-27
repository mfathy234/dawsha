import { execFile } from 'node:child_process'
import { parseShortstat } from '../shared/gitChanges'
import { parseAheadBehind, type SyncCounts } from '../shared/gitBranches'
import { parseNumstat } from '../shared/handoff'
import type { GitChanges } from '../shared/types'
import { readHeadBranch } from './gitHead'

const CHANGES_TTL_MS = 5000
const SYNC_TTL_MS = 20_000

function run(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 3000, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null)
    })
  })
}

const BRANCH_ASK_TTL_MS = 30_000
const branchAsks = new Map<string, { at: number; value: string | null }>()

async function askGitForBranch(folder: string): Promise<string | null> {
  const known = branchAsks.get(folder)
  if (known && Date.now() - known.at < BRANCH_ASK_TTL_MS) return known.value
  const value = (await run(['rev-parse', '--abbrev-ref', 'HEAD'], folder)) ?? (await run(['symbolic-ref', '--short', 'HEAD'], folder))
  branchAsks.set(folder, { at: Date.now(), value })
  return value
}

/** The branch is read from .git/HEAD; git itself is asked only when that fails, and a folder that is not a repository is asked about once every 30 seconds, not on every poll. */
export async function currentBranch(folder: string): Promise<string | null> {
  const fromHead = await readHeadBranch(folder)
  return fromHead ?? askGitForBranch(folder)
}

const changesCache = new Map<string, { at: number; value: GitChanges | null }>()

const syncCache = new Map<string, { at: number; value: SyncCounts | null }>()

export function forgetChanges(): void {
  changesCache.clear()
  syncCache.clear()
}

export async function gitSync(folder: string): Promise<SyncCounts | null> {
  const cached = syncCache.get(folder)
  if (cached && Date.now() - cached.at < SYNC_TTL_MS) return cached.value
  const counts = await run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], folder)
  const value = counts ? parseAheadBehind(counts) : null
  syncCache.set(folder, { at: Date.now(), value })
  return value
}

export async function gitChanges(folder: string): Promise<GitChanges | null> {
  const cached = changesCache.get(folder)
  if (cached && Date.now() - cached.at < CHANGES_TTL_MS) return cached.value
  const inside = await run(['rev-parse', '--is-inside-work-tree'], folder)
  let value: GitChanges | null = null
  if (inside === 'true') {
    const stat = await run(['diff', 'HEAD', '--shortstat'], folder)
    value = stat ? parseShortstat(stat) : { files: 0, added: 0, removed: 0 }
  }
  changesCache.set(folder, { at: Date.now(), value })
  return value
}

export async function changedFiles(folder: string): Promise<string[] | null> {
  const inside = await run(['rev-parse', '--is-inside-work-tree'], folder)
  if (inside !== 'true') return null
  const tracked = await run(['diff', 'HEAD', '--numstat'], folder)
  const untracked = await run(['ls-files', '--others', '--exclude-standard'], folder)
  const files = new Set(tracked ? parseNumstat(tracked) : [])
  for (const path of (untracked ?? '').split('\n')) if (path.trim()) files.add(path.trim())
  return [...files]
}

export async function diffStat(folder: string): Promise<string | null> {
  const inside = await run(['rev-parse', '--is-inside-work-tree'], folder)
  if (inside !== 'true') return null
  return run(['diff', 'HEAD', '--stat'], folder)
}
