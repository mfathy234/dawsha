import { existsSync } from 'node:fs'
import { lstat, readdir, readFile, rmdir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PrTidyRequest, PrTidyResult } from '../shared/prWatch'
import { parseWorktreeList, samePath } from '../shared/worktreeCleanup'
import { matchesWorktreeInclude, parseWorktreeInclude, WORKTREE_SKIP_DIRS } from '../shared/worktreeSetup'
import { git } from './gitCommit'

const MAX_ENTRIES = 400_000
const SLOW_MS = 60_000
const RETRIES = 6
const RETRY_MS = 500

export interface LinkScan {
  links: string[]
  /** More entries than can be checked: removing the folder is not safe to attempt. */
  tooLarge: boolean
}

/**
 * Every symlink and directory junction under a folder. The walk never enters a link, so a node_modules
 * junction to another checkout is listed, not read. Windows reports junctions as symbolic links here.
 */
export async function scanLinks(root: string): Promise<LinkScan> {
  const links: string[] = []
  const pending = [root]
  let seen = 0
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
      if (seen > MAX_ENTRIES) return { links, tooLarge: true }
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) links.push(full)
      else if (entry.isDirectory()) pending.push(full)
      else if (!entry.isFile() && (await lstat(full).then((info) => info.isSymbolicLink(), () => false))) links.push(full)
    }
  }
  return { links, tooLarge: false }
}

const gone = (path: string): Promise<boolean> => lstat(path).then(() => false, (error: NodeJS.ErrnoException) => error.code === 'ENOENT')

/** Removes the link itself, never what it points to. A directory junction goes with rmdir when unlink refuses it. */
async function unlinkOne(path: string): Promise<boolean> {
  try {
    await unlink(path)
  } catch {
    try {
      await rmdir(path)
    } catch {
      return false
    }
  }
  return gone(path)
}

/** Unlinks every link in the folder and checks each is gone. Returns the first one that stayed, or null. */
export async function unlinkAll(links: readonly string[]): Promise<string | null> {
  for (const link of links) {
    if (!(await unlinkOne(link))) return link
  }
  return null
}

const count = (text: string): number => text.split('\n').filter((line) => line.trim() !== '').length

async function unpushedCommits(path: string, headSha: string, strict: boolean): Promise<number> {
  if (/^[0-9a-f]{40}$/i.test(headSha)) {
    const onPr = await git(path, ['merge-base', '--is-ancestor', 'HEAD', headSha])
    if (onPr.ok) return 0
  }
  if (strict) return 1
  const ahead = await git(path, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  const n = ahead.ok ? Number.parseInt(ahead.stdout, 10) : 1
  return Number.isFinite(n) ? n : 1
}

const SKIPPED = new Set<string>(WORKTREE_SKIP_DIRS)

/** Ignored files worth keeping: everything but build and dependency folders and the copies .worktreeinclude made from the main checkout. */
export function ignoredBlockers(paths: readonly string[], includeRules: readonly string[]): string[] {
  return paths.filter((path) => {
    const parts = path.replace(/\/+$/, '').split('/')
    if (parts.some((part) => SKIPPED.has(part.toLowerCase()))) return false
    return !matchesWorktreeInclude(path, includeRules)
  })
}

async function includeRulesOf(repo: string): Promise<string[]> {
  const text = await readFile(join(repo, '.worktreeinclude'), 'utf8').catch(() => '')
  return parseWorktreeInclude(text)
}

/** The ignored files in the worktree that are not disposable, or null when git could not say. */
async function ignoredData(tree: string, repo: string): Promise<string[] | null> {
  const listed = await git(tree, ['status', '--porcelain', '--ignored'])
  if (!listed.ok) return null
  const entries = listed.stdout.split('\n').filter((line) => line.startsWith('!! ')).map((line) => line.slice(3).trim())
  const files: string[] = []
  for (const entry of entries) {
    if (!entry.endsWith('/')) {
      files.push(entry)
      continue
    }
    if (entry.replace(/\/+$/, '').split('/').some((part) => SKIPPED.has(part.toLowerCase()))) continue
    const inside = await git(tree, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', entry])
    files.push(...(inside.ok ? inside.stdout.split('\n').filter((line) => line.trim() !== '') : [entry]))
  }
  return ignoredBlockers(files, await includeRulesOf(repo))
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** The folder git leaves behind when a process still held it as its working directory. Only an empty folder goes, with no recursion. */
async function removeEmptyFolder(path: string): Promise<boolean> {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      if ((await readdir(path)).length > 0) return false
      await rmdir(path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
      await pause(RETRY_MS * attempt)
    }
  }
  return !existsSync(path)
}

/** Windows can hold a folder for a moment after the terminal inside it stops. */
async function removeWithRetry(repo: string, path: string): Promise<{ ok: boolean; message: string }> {
  let result = await git(repo, ['worktree', 'remove', path], SLOW_MS)
  for (let attempt = 1; !result.ok && existsSync(path) && attempt < RETRIES; attempt += 1) {
    if (/is not a working tree/i.test(result.message)) return { ok: await removeEmptyFolder(path), message: result.message }
    await pause(RETRY_MS * attempt)
    result = await git(repo, ['worktree', 'remove', path], SLOW_MS)
  }
  return result
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Removes a session's worktree after a merge. It refuses when the folder has uncommitted changes or commits that
 * are on no remote, and it unlinks every symlink and junction first so no file outside the worktree can be deleted.
 */
export async function removeWorktreeSafely(request: PrTidyRequest): Promise<PrTidyResult> {
  const { repo, path, branch, headSha, strict, dryRun } = request
  if (typeof repo !== 'string' || typeof path !== 'string' || typeof branch !== 'string' || !repo || !path) return { ok: false, error: 'There is no worktree to remove.' }
  const listed = await git(repo, ['worktree', 'list', '--porcelain', '-z'])
  if (!listed.ok) return { ok: false, error: 'This project is not a git repository.' }
  const trees = parseWorktreeList(listed.stdout)
  const tree = trees.find((item) => samePath(item.path, path))
  if (!tree || samePath(trees[0]?.path ?? '', path)) return { ok: false, error: 'That folder is not a linked worktree of this project, so it was left alone.' }
  if (!existsSync(tree.path)) {
    await git(repo, ['worktree', 'prune'])
    return { ok: true }
  }
  const info = await lstat(tree.path).catch(() => null)
  if (!info || info.isSymbolicLink() || !info.isDirectory()) return { ok: false, error: `${resolve(tree.path)} is not a plain folder, so it was left alone.` }
  const status = await git(tree.path, ['status', '--porcelain'])
  if (!status.ok) return { ok: false, error: 'Could not check the worktree for changes, so it was kept.' }
  if (count(status.stdout) > 0) return { ok: false, error: `The worktree has ${plural(count(status.stdout), 'uncommitted change')}, so it was kept.` }
  const ignored = await ignoredData(tree.path, trees[0]?.path ?? repo)
  if (ignored === null) return { ok: false, error: 'Could not check the worktree for ignored files, so it was kept.' }
  if (ignored.length > 0) {
    const names = ignored.slice(0, 3).join(', ')
    return { ok: false, error: `The worktree has ${plural(ignored.length, 'ignored file')} that git does not track (${names}${ignored.length > 3 ? ', ...' : ''}), so it was kept.` }
  }
  const unpushed = await unpushedCommits(tree.path, headSha, strict === true)
  if (unpushed > 0) return { ok: false, error: `The worktree has ${plural(unpushed, 'commit')} that are not on any remote, so it was kept.` }
  if (dryRun) return { ok: true }
  const scan = await scanLinks(tree.path)
  if (scan.tooLarge) return { ok: false, error: 'The worktree is too large to check for links, so it was kept.' }
  const stuck = await unlinkAll(scan.links)
  if (stuck) return { ok: false, error: `Could not unlink ${stuck}, so the worktree was kept.` }
  const removed = await removeWithRetry(repo, tree.path)
  await git(repo, ['worktree', 'prune'])
  if (!removed.ok && existsSync(tree.path)) return { ok: false, error: `git could not remove the worktree: ${removed.message.split('\n')[0]}` }
  return { ok: true }
}
