import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const MAX_LEVELS = 40
const FULL_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/i

/** The branch a HEAD file names, a short commit id when it is detached, or null when it says something else. */
export function parseHead(content: string): string | null {
  const text = content.trim()
  if (text.startsWith('ref:')) {
    const ref = text.slice(4).trim()
    return ref.startsWith('refs/heads/') && ref.length > 'refs/heads/'.length ? ref.slice('refs/heads/'.length) : null
  }
  return FULL_SHA.test(text) ? text.slice(0, 7) : null
}

/** The folder a `.git` file points to ("gitdir: ../.git/worktrees/x"), relative to the folder that holds the file. */
export function parseGitdirFile(content: string, holder: string): string | null {
  const match = /^gitdir:\s*(.+)$/m.exec(content)
  if (!match) return null
  const target = match[1].trim()
  return isAbsolute(target) ? target : resolve(holder, target)
}

async function gitDirOf(folder: string): Promise<string | null> {
  let dir = resolve(folder)
  for (let level = 0; level < MAX_LEVELS; level += 1) {
    const candidate = join(dir, '.git')
    const info = await stat(candidate).catch(() => null)
    if (info?.isDirectory()) return candidate
    if (info?.isFile()) return parseGitdirFile(await readFile(candidate, 'utf8'), dir)
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/** Reads the current branch straight from `.git/HEAD` (also in a worktree), so the poll spawns no process. Null when it cannot tell and git should be asked. */
export async function readHeadBranch(folder: string): Promise<string | null> {
  try {
    const gitDir = await gitDirOf(folder)
    return gitDir ? parseHead(await readFile(join(gitDir, 'HEAD'), 'utf8')) : null
  } catch {
    return null
  }
}
