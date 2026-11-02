import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ClipboardItem, clipboard, nativeImage, shell } from 'electron'
import {
  IMAGE_MAX_BYTES, IMAGE_MAX_EDGE, sniffImageMime, type ChatImageActionRequest, type ChatImageActionResult, type ChatImageRequest, type ChatImageResult, type ImageMime
} from '../../shared/chatImage'
import { pasteDir } from '../clipboardImage'
import { logTo, revealInFolder } from '../desktop'
import { checkImageFile } from './imageAccess'
import type { ImageEntry } from './imageTable'
import { chatImageEntry } from './service'

interface Loaded {
  bytes: Buffer
  mime: ImageMime
  /** The checked file, when the picture came from one. */
  real?: string
}

type Failure = { status: 'too-large' | 'missing' | 'blocked' }

const EXTENSIONS: Readonly<Record<ImageMime, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' }

async function loadEntry(entry: ImageEntry, folder: string): Promise<Loaded | Failure> {
  if (entry.kind === 'oversize') return { status: 'too-large' }
  if (entry.kind === 'bytes') {
    const mime = sniffImageMime(entry.data)
    return mime ? { bytes: entry.data, mime } : { status: 'blocked' }
  }
  const checked = await checkImageFile(entry.path, [folder, pasteDir()])
  if (!checked.ok) return { status: checked.status }
  try {
    const bytes = await readFile(checked.real)
    const mime = sniffImageMime(bytes)
    return mime && bytes.length <= IMAGE_MAX_BYTES ? { bytes, mime, real: checked.real } : { status: 'blocked' }
  } catch {
    return { status: 'missing' }
  }
}

const failed = (loaded: Loaded | Failure): loaded is Failure => 'status' in loaded

/** Shrinks a picture to the longest edge Chat shows. Formats Electron cannot decode pass through unchanged. */
function fitted(loaded: Loaded): { dataUrl: string; mime: ImageMime; width: number; height: number } {
  const image = nativeImage.createFromBuffer(loaded.bytes)
  const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
  const longest = Math.max(size.width, size.height)
  if (longest <= IMAGE_MAX_EDGE) return { dataUrl: `data:${loaded.mime};base64,${loaded.bytes.toString('base64')}`, mime: loaded.mime, ...size }
  const scale = IMAGE_MAX_EDGE / longest
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  const small = image.resize({ width, height, quality: 'good' })
  const jpeg = loaded.mime === 'image/jpeg'
  const out = jpeg ? small.toJPEG(85) : small.toPNG()
  const mime: ImageMime = jpeg ? 'image/jpeg' : 'image/png'
  return { dataUrl: `data:${mime};base64,${out.toString('base64')}`, mime, width, height }
}

/** A picture of a session as a data: URL, looked up by the id its own reader made. A path never arrives from the page. */
export async function loadChatImage(request: ChatImageRequest): Promise<ChatImageResult> {
  const found = chatImageEntry(request?.agent, request?.sessionId, request?.imageId)
  if (!found) return { status: 'missing' }
  const loaded = await loadEntry(found.entry, found.folder)
  if (failed(loaded)) return loaded
  try {
    return { status: 'ok', ...fitted(loaded) }
  } catch {
    return { status: 'blocked' }
  }
}

/** A picture from the log, written once to the paste folder so the system can open or show it. */
function savedCopy(loaded: Loaded): string {
  const dir = pasteDir()
  mkdirSync(dir, { recursive: true })
  const name = `chat-${createHash('sha1').update(loaded.bytes).digest('hex').slice(0, 12)}.${EXTENSIONS[loaded.mime]}`
  const path = join(dir, name)
  writeFileSync(path, loaded.bytes)
  return path
}

async function perform(request: ChatImageActionRequest, loaded: Loaded): Promise<boolean> {
  if (request.action === 'copy') {
    const image = nativeImage.createFromBuffer(loaded.bytes)
    if (image.isEmpty()) return false
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
    return true
  }
  const path = loaded.real ?? savedCopy(loaded)
  const log = process.env.DAWSHA_OPEN_LOG
  if (request.action === 'reveal') {
    revealInFolder(path)
    return true
  }
  if (log) {
    logTo(log, JSON.stringify({ kind: 'image', path }))
    return true
  }
  return (await shell.openPath(path)) === ''
}

/** Copy, open or reveal a picture. Files must pass the same containment check as showing them. */
export async function runChatImageAction(request: ChatImageActionRequest): Promise<ChatImageActionResult> {
  if (request?.action !== 'copy' && request?.action !== 'open' && request?.action !== 'reveal') return { ok: false }
  const found = chatImageEntry(request.agent, request.sessionId, request.imageId)
  if (!found) return { ok: false }
  const loaded = await loadEntry(found.entry, found.folder)
  if (failed(loaded)) return { ok: false }
  try {
    return { ok: await perform(request, loaded) }
  } catch {
    return { ok: false }
  }
}
