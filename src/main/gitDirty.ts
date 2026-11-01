import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DirtyReportResult } from '../shared/gitBranches'
import type { UntrackedFolder, UntrackedFoldersResult } from '../shared/gitIgnore'
import { parseStatusV2 } from '../shared/gitStatus'
import { git, repoRoot } from './gitCommit'

/** Listing new files stops here, and the answer says "over". */
export const MAX_NEW_FILES = 5000
export const BUDGET_MS = 6000
const MAX_FOLDERS = 40
const STAT_BATCH = 64

interface Listing {
  paths: string[]
  capped: boolean
}

/** New files under `scope` (the whole repository when empty), read from git as it prints them and stopped at the limits. No shell. */
export function listNewFiles(root: string, scope: string | null, limit = MAX_NEW_FILES, budgetMs = BUDGET_MS): Promise<Listing> {
  return new Promise((resolveList) => {
    const args = ['--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z', ...(scope ? ['--', scope] : [])]
    const child = spawn('git', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const paths: string[] = []
    let rest = ''
    let capped = false
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveList({ paths, capped })
    }
    const stop = (): void => {
      capped = true
      child.kill()
      finish()
    }
    const timer = setTimeout(stop, budgetMs)
    // Decodes across chunks, so a name split between two reads is not garbled.
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const parts = (rest + chunk).split('\0')
      rest = parts.pop() ?? ''
      for (const part of parts) if (part !== '') paths.push(part)
      if (paths.length > limit) {
        paths.length = limit
        stop()
      }
    })
    child.on('error', finish)
    child.on('close', () => {
      if (rest !== '' && paths.length < limit) paths.push(rest)
      finish()
    })
  })
}

/** Adds up file sizes in small parallel batches, stopping at the deadline. */
export async function sumSizes(root: string, paths: readonly string[], deadline: number): Promise<{ bytes: number; capped: boolean }> {
  let bytes = 0
  for (let at = 0; at < paths.length; at += STAT_BATCH) {
    if (Date.now() > deadline) return { bytes, capped: true }
    const sizes = await Promise.all(paths.slice(at, at + STAT_BATCH).map((path) => lstat(join(root, path)).then((info) => (info.isFile() ? info.size : 0), () => 0)))
    for (const size of sizes) bytes += size
  }
  return { bytes, capped: false }
}

/** How many tracked files differ from HEAD (staged ones included) and how many new files there are, with their size. */
export async function dirtyReport(folder: unknown): Promise<DirtyReportResult> {
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  const status = await git(root, ['status', '--porcelain=v2', '-z', '--untracked-files=no'])
  if (!status.ok) return { ok: false, error: status.message }
  const modified = parseStatusV2(status.stdout).files.length
  const deadline = Date.now() + BUDGET_MS
  const listing = await listNewFiles(root, null)
  const sized = await sumSizes(root, listing.paths, deadline)
  return { ok: true, report: { modified, untracked: listing.paths.length, untrackedBytes: sized.bytes, capped: listing.capped || sized.capped } }
}

async function folderInfo(root: string, path: string, deadline: number): Promise<UntrackedFolder | null> {
  const listing = await listNewFiles(root, path)
  if (listing.paths.length === 0) return null
  const sized = await sumSizes(root, listing.paths, deadline)
  return { path, files: listing.paths.length, bytes: sized.bytes, capped: listing.capped || sized.capped }
}

/** Folders git shows as one untracked entry (`git status` without -uall): nothing tracked or staged inside. */
export async function untrackedFolders(folder: unknown): Promise<UntrackedFoldersResult> {
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  if (!status.ok) return { ok: false, error: status.message }
  const dirs = status.stdout.split('\0').filter((entry) => entry.startsWith('?? ') && entry.endsWith('/')).map((entry) => entry.slice(3)).slice(0, MAX_FOLDERS)
  const deadline = Date.now() + BUDGET_MS
  const infos = await Promise.all(dirs.map((dir) => folderInfo(root, dir, deadline)))
  return { ok: true, folders: infos.filter((info): info is UntrackedFolder => info !== null) }
}
