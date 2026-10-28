const MAX_FOLDERS = 40

const normal = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')
const comparable = (path: string): string => normal(path).toLowerCase()
export const isAbsolutePath = (path: string): boolean => /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(path)

const parentOf = (path: string): string => {
  const clean = normal(path)
  const cut = clean.lastIndexOf('/')
  return cut <= 0 ? clean : clean.slice(0, cut)
}

const inside = (root: string, path: string): boolean => {
  const a = comparable(root)
  const b = comparable(path)
  return b === a || b.startsWith(`${a}/`)
}

/**
 * The folders sessions of a project touched outside it: the parent of every absolute file path that is not inside the
 * project or one of its checkouts, most touched first. A later step turns each into its repository root.
 */
export function externalFolders(paths: readonly string[], projectFolder: string, checkouts: readonly string[] = []): string[] {
  const own = [projectFolder, ...checkouts]
  const counts = new Map<string, { folder: string; count: number }>()
  for (const path of paths) {
    if (!isAbsolutePath(path) || own.some((root) => inside(root, path))) continue
    const folder = parentOf(path)
    const key = comparable(folder)
    const known = counts.get(key)
    counts.set(key, { folder, count: (known?.count ?? 0) + 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || (a.folder < b.folder ? -1 : 1)).slice(0, MAX_FOLDERS).map((entry) => entry.folder)
}

/** Folders that sit inside another listed folder collapse into it; the repository roots resolved from them are deduplicated by the caller. */
export function dedupeRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const root of roots) {
    const key = comparable(root)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(root)
  }
  return out
}

export interface LinkedRepo {
  folder: string
  name: string
  /** The configured project that accepts this folder, or null when Dawsha does not know it. */
  projectId: string | null
}

export const folderName = (folder: string): string => normal(folder).split('/').pop() || folder
