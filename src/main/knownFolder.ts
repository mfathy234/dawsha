import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { git, insideRoot } from './gitCommit'

const same = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

async function real(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

async function commonDir(folder: string): Promise<{ common: string; linked: boolean } | null> {
  const out = await git(folder, ['rev-parse', '--git-common-dir', '--git-dir'])
  if (!out.ok) return null
  const [common, dir] = out.stdout.split('\n').map((line) => line.trim())
  if (!common || !dir) return null
  const [realCommon, realDir] = await Promise.all([real(resolve(folder, common)), real(resolve(folder, dir))])
  return realCommon && realDir ? { common: realCommon, linked: !same(realCommon, realDir) } : null
}

// The folder when it is a configured project, inside one, or a linked git worktree of one; otherwise null.
// Every file IPC goes through this so the renderer cannot point main at an arbitrary directory.
export async function knownProjectFolder(projects: ReadonlyArray<{ folder: string }>, folder: unknown): Promise<string | null> {
  if (typeof folder !== 'string' || folder === '' || folder.includes('\0')) return null
  const target = await real(resolve(folder))
  if (!target) return null
  const roots: string[] = []
  for (const project of projects) {
    const root = await real(resolve(project.folder))
    if (root) roots.push(root)
  }
  const win = process.platform === 'win32'
  for (const root of roots) {
    if (same(root, target)) return folder
    if (insideRoot(win ? root.toLowerCase() : root, win ? target.toLowerCase() : target)) return folder
  }
  const mine = await commonDir(target)
  if (!mine || !mine.linked) return null
  for (const root of roots) {
    const theirs = await commonDir(root)
    if (theirs && same(theirs.common, mine.common)) return folder
  }
  return null
}
