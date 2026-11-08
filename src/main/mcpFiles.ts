import { copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'

export const MAX_MCP_FILE_BYTES = 20 * 1024 * 1024
export const BACKUP_SUFFIX = '.dawsha-bak'

export interface FileSnapshot {
  text: string
  mtimeMs: number
  size: number
}

/** The file's text and the stamp used to notice a change before saving; null when it does not exist or is too large to be a config. */
export async function readSnapshot(path: string): Promise<FileSnapshot | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_MCP_FILE_BYTES) return null
    return { text: await readFile(path, 'utf8'), mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return null
  }
}

export const readText = async (path: string): Promise<string | null> => (await readSnapshot(path))?.text ?? null

/**
 * Replaces the file with `text`: the previous version is copied to `<file>.dawsha-bak`, the new text goes to a temp file beside it and is renamed over it.
 * Refuses when the file changed since `before` was read, because an agent may be writing it too.
 */
export async function saveAtomically(path: string, text: string, before: FileSnapshot): Promise<{ ok: true } | { ok: false; error: string }> {
  const temp = `${path}.dawsha-tmp`
  try {
    await writeFile(temp, text, 'utf8')
    const now = await stat(path)
    if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) {
      await rm(temp, { force: true })
      return { ok: false, error: 'The file changed while Dawsha was saving. Nothing was written; try again.' }
    }
    await copyFile(path, `${path}${BACKUP_SUFFIX}`)
    await rename(temp, path)
    return { ok: true }
  } catch {
    await rm(temp, { force: true }).catch(() => undefined)
    return { ok: false, error: 'The file could not be saved. Nothing was changed.' }
  }
}
