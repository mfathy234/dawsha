import type { TabAgent } from './types'

export type ChatImageOrigin = 'log' | 'file'

/** A picture in the thread. Only a reference: the bytes stay in main and are fetched by id when the picture scrolls into view. */
export interface ChatImageRef {
  id: string
  source: ChatImageOrigin
  mime: string
  width?: number
  height?: number
  label?: string
}

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const IMAGE_MAX_EDGE = 1600
export const IMAGE_TABLE_MAX_BYTES = 20 * 1024 * 1024

export interface ChatImageRequest {
  agent: TabAgent
  sessionId: string
  imageId: string
}

export type ChatImageResult =
  | { status: 'ok'; dataUrl: string; mime: ImageMime; width: number; height: number }
  | { status: 'too-large' | 'missing' | 'blocked' }

export type ChatImageAction = 'copy' | 'open' | 'reveal'

export interface ChatImageActionRequest extends ChatImageRequest {
  action: ChatImageAction
}

export interface ChatImageActionResult {
  ok: boolean
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean => signature.every((value, index) => bytes[at + index] === value)

/** The image type the first bytes say it is. Only the five formats Chat shows; never SVG, whatever the name or declared type says. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length < 12) return null
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp'
  return null
}

const readU16 = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1]
const readU32 = (b: Uint8Array, at: number): number => b[at] * 2 ** 24 + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: readU16(bytes, at + 5), width: readU16(bytes, at + 7) }
    at += 2 + readU16(bytes, at + 2)
  }
  return null
}

/** Width and height read from the header of a PNG, GIF or JPEG; null for any other or a damaged header. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const mime = sniffImageMime(bytes)
  if (mime === 'image/png' && bytes.length >= 24) return { width: readU32(bytes, 16), height: readU32(bytes, 20) }
  if (mime === 'image/gif') return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  if (mime === 'image/jpeg') return jpegSize(bytes)
  return null
}

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i

/** A base64 data: URL of an image, split into its declared type and payload. */
export function parseImageDataUrl(url: string): { mime: string; base64: string } | null {
  const match = DATA_URL.exec(url)
  return match ? { mime: match[1].toLowerCase(), base64: match[2].replace(/\s/g, '') } : null
}

/** The path inside a file:// URL, as Windows or POSIX; a plain absolute path passes; null for anything else. */
export function fileUrlToPath(value: string): string | null {
  if (!/^file:\/\//i.test(value)) return /^(?:[A-Za-z]:[\\/]|\/)/.test(value) ? value : null
  try {
    const url = new URL(value)
    if (url.host !== '' && url.host !== 'localhost') return null
    const path = decodeURIComponent(url.pathname)
    return /^\/[A-Za-z]:/.test(path) ? path.slice(1).replace(/\//g, '\\') : path
  } catch {
    return null
  }
}

const MARKER = /\[Image: source: ([^\]\r\n]+)\]/g

/** Claude writes `[Image: source: <path>]` beside a picture it was given. The marker is not for reading; the path is kept. */
export function stripImageMarkers(text: string): { text: string; paths: string[] } {
  const paths = [...text.matchAll(MARKER)].map((match) => match[1].trim())
  const cleaned = paths.length === 0 ? text : text.replace(MARKER, '').replace(/\n{3,}/g, '\n\n').trim()
  return { text: cleaned, paths }
}

const EXTENSION_MIME: Readonly<Record<string, ImageMime>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp'
}

export function mimeFromName(name: string): ImageMime | null {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (EXTENSION_MIME[name.slice(dot + 1).toLowerCase()] ?? null)
}

export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path
