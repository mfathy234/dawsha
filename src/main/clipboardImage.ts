import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, clipboard } from 'electron'
import type { ClipboardContent } from '../shared/clipboard'

const KEEP_MS = 24 * 60 * 60 * 1000

export const pasteDir = (): string => process.env.DAWSHA_PASTE_DIR ?? join(app.getPath('temp'), 'dawsha-paste')

function pruneOld(dir: string, now: number): void {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    try {
      if (now - statSync(file).mtimeMs > KEEP_MS) unlinkSync(file)
    } catch {
      continue
    }
  }
}

async function readImage(): Promise<Buffer | null> {
  for (const item of await clipboard.read()) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (!type) continue
    const blob = await item.getType(type)
    if (blob instanceof Blob) return Buffer.from(await blob.arrayBuffer())
  }
  return null
}

export async function readClipboardContent(): Promise<ClipboardContent> {
  const text = await clipboard.readText().catch(() => '')
  if (text) return { kind: 'text', text }
  const image = await readImage().catch(() => null)
  if (!image) return { kind: 'empty' }
  const dir = pasteDir()
  mkdirSync(dir, { recursive: true })
  const now = Date.now()
  pruneOld(dir, now)
  const path = join(dir, `paste-${now}.png`)
  writeFileSync(path, image)
  return { kind: 'image', path }
}
