import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'

export type RestorePaths = { ok: true; paths: string[] } | { ok: false; error: string }

const MAX_PATHS = 200
const bad = (path: string): RestorePaths => ({ ok: false, error: `Not a file inside this repository: ${path}` })

function inside(root: string, path: string): string | null {
  if (path === '' || path.includes('\0')) return null
  const absolute = isAbsolute(path) || win32.isAbsolute(path)
  if (absolute && !isAbsolute(path)) return null
  if (!absolute && path.split(/[\/]/).includes('..')) return null
  const rel = relative(root, resolve(root, path))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  const parts = rel.split(sep)
  if (parts.some((part) => part.toLowerCase() === '.git')) return null
  return parts.join('/')
}

/** Turns the summary's paths into unique repo-relative, forward-slash paths; anything outside the root, or inside `.git`, fails the whole request. */
export function normalizeRestorePaths(root: string, paths: unknown): RestorePaths {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) return { ok: false, error: 'No files to restore.' }
  const out = new Set<string>()
  for (const path of paths) {
    const clean = typeof path === 'string' ? inside(root, path) : null
    if (!clean) return bad(String(path))
    out.add(clean)
  }
  return { ok: true, paths: [...out] }
}
