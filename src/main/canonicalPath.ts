import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export async function canonicalPath(file: string): Promise<string> {
  try {
    return await realpath(file)
  } catch {
    const parent = dirname(file)
    if (parent === file) return file
    return join(await canonicalPath(parent), basename(file))
  }
}
