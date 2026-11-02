import { realpath as realpathCallback } from 'node:fs'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { isAbsolute } from 'node:path'
import { IMAGE_MAX_BYTES } from '../../shared/chatImage'
import { containsProjectPath } from '../projectContainment'

export type FileCheck = { ok: true; real: string; size: number } | { ok: false; status: 'missing' | 'blocked' | 'too-large' }

// The native call also expands Windows 8.3 short names, so MICROT~1 and Microtec-Dev compare as the same folder.
const realpath = promisify(realpathCallback.native)

const isNetworkPath = (path: string): boolean => /^[\\/]{2}/.test(path)

async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/**
 * A picture file the log named. It must be absolute, resolve (through links) to a real file, lie inside one of the allowed folders
 * (the project and the paste folder), and be no bigger than the cap. The path comes from a session log read in main, never from the page.
 */
export async function checkImageFile(path: string, roots: readonly string[]): Promise<FileCheck> {
  if (typeof path !== 'string' || !isAbsolute(path) || isNetworkPath(path)) return { ok: false, status: 'blocked' }
  const real = await realOrNull(path)
  if (!real) return { ok: false, status: 'missing' }
  if (isNetworkPath(real)) return { ok: false, status: 'blocked' }
  const realRoots = (await Promise.all(roots.filter((root) => root !== '' && isAbsolute(root)).map(realOrNull))).filter((root): root is string => root !== null)
  if (!realRoots.some((root) => containsProjectPath(root, real))) return { ok: false, status: 'blocked' }
  try {
    const info = await stat(real)
    if (!info.isFile()) return { ok: false, status: 'missing' }
    if (info.size > IMAGE_MAX_BYTES) return { ok: false, status: 'too-large' }
    return { ok: true, real, size: info.size }
  } catch {
    return { ok: false, status: 'missing' }
  }
}
