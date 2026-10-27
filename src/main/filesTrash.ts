import { lstat, realpath, readdir } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import type { FilesTrashResult } from '../shared/filesWorkspace'
import { knownProjectFolder } from './knownFolder'

// Reject symlinks at every component, including the selected node. Never traverse a link to delete.
async function trashTarget(folder: string, path: unknown): Promise<string> {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || path.includes(':') || isAbsolute(path)) throw new Error('Invalid path for Trash.')
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error('Cannot trash the checkout root or Git metadata.')
  if (process.platform === 'win32' && parts.some(part => /[. ]$/.test(part))) throw new Error('Ambiguous Windows path cannot be moved to Trash.')
  const root = await realpath(folder)
  if (root.split(/[\\/]/).some(part => part.toLowerCase() === '.git')) throw new Error('Cannot trash Git metadata.')
  let full = root
  for (const part of parts) {
    full = join(full, part)
    const entry = await lstat(full)
    if (entry.isSymbolicLink()) throw new Error('Cannot trash symbolic links or paths through them.')
  }
  const actual = await realpath(full)
  const rel = relative(root, actual)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside the checkout.')
  const pending = [full]
  let visited = 0
  while (pending.length) {
    const candidate = pending.pop()!
    if (++visited > 20_000) throw new Error('This folder is too large to validate safely. Choose a smaller folder.')
    const entry = await lstat(candidate)
    if (entry.isSymbolicLink()) throw new Error('This folder contains a symbolic link and cannot be safely moved to Trash.')
    if (entry.isDirectory()) {
      for (const child of await readdir(candidate)) {
        if (child.toLowerCase() === '.git') throw new Error('This folder contains Git metadata and cannot be moved to Trash.')
        pending.push(join(candidate, child))
        if (pending.length + visited > 20_000) throw new Error('This folder is too large to validate safely. Choose a smaller folder.')
      }
    }
  }
  return resolve(full)
}

export async function trashProjectPath(projects: ReadonlyArray<{ folder: string }>, folder: unknown, path: unknown, trash: (path: string) => Promise<void>): Promise<FilesTrashResult> {
  try {
    const known = await knownProjectFolder(projects, folder)
    if (!known) return { ok: false, error: 'Not a project folder.' }
    await trashTarget(known, path)
    // Validate again immediately before handing the path to the operating system.
    const full = await trashTarget(known, path)
    await trash(full)
    return { ok: true }
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not move this path to Trash.' } }
}
