import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { posix } from 'node:path'
import { isHtmlPath } from '../shared/filePreview'
import { MAX_READ_BYTES, resolveProjectFile } from './gitWorkspace'

export const PREVIEW_SCHEME = 'dawsha-preview'

// Scripts and styles the page carries may run; nothing may leave the machine: no fetch, no frames, no forms.
// Images, styles, fonts and media come from the page's own folder (this scheme) or are inlined.
export const PREVIEW_CSP = `default-src 'none'; script-src 'unsafe-inline' ${PREVIEW_SCHEME}:; style-src 'unsafe-inline' ${PREVIEW_SCHEME}:; img-src ${PREVIEW_SCHEME}: data: blob:; font-src ${PREVIEW_SCHEME}: data:; media-src ${PREVIEW_SCHEME}: data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`

const MAX_ASSET_BYTES = 32 * 1024 * 1024
const MAX_TREES = 50

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg'
}

const lower = (text: string): string => (process.platform === 'win32' ? text.toLowerCase() : text)

export interface PreviewResponse {
  status: number
  headers: Record<string, string>
  body: Buffer | string
}

export type PreviewRegistration = { ok: true; url: string } | { ok: false; error: string }

interface Tree {
  folder: string
  /** The page's folder as requested and as it really is on disk, relative to the repository; only files below it are served. */
  base: string
  realBase: string
  overrides: Map<string, string>
}

const answer = (status: number, body: Buffer | string, type = 'text/plain; charset=utf-8'): PreviewResponse => ({
  status,
  body,
  headers: { 'Content-Type': type, 'Content-Security-Policy': PREVIEW_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }
})

const dirOf = (rel: string): string => {
  const dir = posix.dirname(rel)
  return dir === '.' ? '' : dir
}

/**
 * Serves HTML previews from a custom scheme so each response carries its own policy. A preview is one folder tree of one
 * project: the page and what lies below it. Every file still goes through the project's file check (symlinks resolved),
 * and the project must still be a known folder when it is asked for.
 */
export class PreviewServer {
  private readonly trees = new Map<string, Tree>()
  private version = 0

  constructor(private readonly gate: (folder: string) => Promise<string | null>) {}

  /** The URL to load a page from. The text, when given, is what the editor holds and is served instead of the saved file. */
  async register(folder: unknown, path: unknown, text: string | null): Promise<PreviewRegistration> {
    if (typeof folder !== 'string' || typeof path !== 'string' || !isHtmlPath(path)) return { ok: false, error: 'Not an HTML file.' }
    if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > MAX_READ_BYTES) return { ok: false, error: 'File is too large to preview here.' }
    const known = await this.gate(folder)
    if (!known) return { ok: false, error: 'Not a project folder.' }
    const target = await resolveProjectFile(known, path)
    if (!target.ok && !target.missing) return { ok: false, error: target.error }
    const rel = target.ok ? target.rel : (target.missing as { rel: string }).rel
    const realRel = target.ok ? target.realRel : rel
    const base = dirOf(rel)
    const key = `${known}|${base}`
    let token = [...this.trees.entries()].find(([, tree]) => `${tree.folder}|${tree.base}` === key)?.[0]
    if (!token) {
      token = randomBytes(12).toString('hex')
      this.trees.set(token, { folder: known, base, realBase: dirOf(realRel), overrides: new Map() })
      if (this.trees.size > MAX_TREES) this.trees.delete(this.trees.keys().next().value as string)
    }
    const tree = this.trees.get(token) as Tree
    if (typeof text === 'string') tree.overrides.set(rel, text)
    else tree.overrides.delete(rel)
    this.version += 1
    return { ok: true, url: `${PREVIEW_SCHEME}://${token}/${encodeURIComponent(posix.basename(rel))}?v=${this.version}` }
  }

  async serve(rawUrl: string): Promise<PreviewResponse> {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      return answer(400, 'Bad request.')
    }
    const tree = this.trees.get(url.hostname)
    if (!tree) return answer(404, 'Not found.')
    const segments: string[] = []
    for (const part of url.pathname.split('/').filter((piece) => piece !== '')) {
      let decoded: string
      try {
        decoded = decodeURIComponent(part)
      } catch {
        return answer(400, 'Bad request.')
      }
      if (decoded === '.' || decoded === '..' || /[\\/:\0]/.test(decoded)) return answer(400, 'Bad request.')
      segments.push(decoded)
    }
    if (segments.length === 0) return answer(404, 'Not found.')
    const rel = [tree.base, ...segments].filter(Boolean).join('/')
    const held = tree.overrides.get(rel)
    if (held !== undefined) return answer(200, held, TYPES.html)
    if (!(await this.gate(tree.folder))) return answer(403, 'Not allowed.')
    const target = await resolveProjectFile(tree.folder, rel)
    if (!target.ok) return answer(404, 'Not found.')
    if (tree.realBase !== '' && !lower(target.realRel).startsWith(`${lower(tree.realBase)}/`)) return answer(404, 'Not found.')
    try {
      const info = await stat(target.full)
      if (!info.isFile() || info.size > MAX_ASSET_BYTES) return answer(404, 'Not found.')
      const ext = target.full.slice(target.full.lastIndexOf('.') + 1).toLowerCase()
      return answer(200, await readFile(target.full), TYPES[ext] ?? 'application/octet-stream')
    } catch {
      return answer(404, 'Not found.')
    }
  }
}
