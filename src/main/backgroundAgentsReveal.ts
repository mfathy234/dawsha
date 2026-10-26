import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { shell } from 'electron'
import { BG_KINDS, type BgKind } from '../shared/backgroundAgents'

const inside = (root: string, path: string): boolean => {
  const rel = relative(resolve(root), resolve(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Shows an agent's transcript in the file manager. Only a path the scanner returned, under the Claude or Codex home, is shown. */
export async function revealAgentFile(path: string | null, roots: readonly string[], kind: unknown): Promise<boolean> {
  if (!path || !BG_KINDS.includes(kind as BgKind) || !roots.some((root) => inside(root, path))) return false
  try {
    if (!(await stat(path)).isFile()) return false
  } catch {
    return false
  }
  if (process.env.DAWSHA_OPEN_LOG) return true
  shell.showItemInFolder(resolve(path))
  return true
}
