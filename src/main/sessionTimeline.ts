import { open, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import {
  TIMELINE_EXPORT_MAX,
  type TimelineEvent,
  type TimelineExportRequest,
  type TimelineExportResult,
  type TimelineRequest,
  type TimelineResult
} from '../shared/timeline'
import { createLineParser, parseGeminiTimeline, type TimelineParser } from '../shared/timelineParse'
import { locateSession } from './transcriptExport'

export const TIMELINE_MAX_BYTES = 8 * 1024 * 1024
const CACHE_LIMIT = 5
const MISS_TTL_MS = 15_000

interface Cached {
  path: string
  parser: TimelineParser | null
  offset: number
  size: number
  mtime: number
  truncated: boolean
  version: string
  events: TimelineEvent[]
}

interface Located {
  path: string | null
  at: number
}

const located = new Map<string, Located>()
const parsed = new Map<string, Cached>()
const locks = new Map<string, Promise<unknown>>()
let counter = 0

const keyOf = (request: TimelineRequest): string => `${request.agent}:${request.sessionId ?? ''}`

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > CACHE_LIMIT) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

async function pathFor(request: TimelineRequest, now: number): Promise<string | null> {
  const key = keyOf(request)
  const known = located.get(key)
  if (known?.path) {
    try {
      if ((await stat(known.path)).isFile()) return known.path
    } catch {
      located.delete(key)
    }
  } else if (known && now - known.at < MISS_TTL_MS) {
    return null
  }
  const found = await locateSession(request)
  remember(located, key, { path: found?.path ?? null, at: now })
  return found?.path ?? null
}

/** Reads bytes from `offset`, cut at the last newline so a half-written line waits for the next read. */
async function readLines(path: string, offset: number, size: number): Promise<{ text: string; used: number }> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(size - offset)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
    const end = buffer.subarray(0, bytesRead).lastIndexOf(0x0a)
    if (end < 0) return { text: '', used: 0 }
    return { text: buffer.subarray(0, end + 1).toString('utf8'), used: end + 1 }
  } finally {
    await handle.close()
  }
}

/** Where to start reading: the whole file, or its last TIMELINE_MAX_BYTES from the next whole line. */
async function startOffset(path: string, size: number): Promise<{ offset: number; truncated: boolean }> {
  if (size <= TIMELINE_MAX_BYTES) return { offset: 0, truncated: false }
  const from = size - TIMELINE_MAX_BYTES
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(65536, size - from))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from)
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a)
    return { offset: newline < 0 ? size : from + newline + 1, truncated: true }
  } finally {
    await handle.close()
  }
}

async function refresh(request: TimelineRequest, path: string, cached: Cached | undefined, size: number, mtime: number): Promise<Cached> {
  const agent = request.agent as 'claude' | 'codex' | 'gemini'
  if (agent === 'gemini') {
    const tooBig = size > TIMELINE_MAX_BYTES
    counter += 1
    return { path, parser: null, offset: size, size, mtime, truncated: tooBig, version: `${counter}`, events: tooBig ? [] : parseGeminiTimeline(await readWhole(path, size)) }
  }
  const reuse = cached && cached.path === path && cached.parser !== null && size >= cached.offset
  const parser = reuse ? (cached.parser as TimelineParser) : createLineParser(agent)
  const start = reuse ? { offset: cached.offset, truncated: cached.truncated } : await startOffset(path, size)
  const { text, used } = await readLines(path, start.offset, size)
  if (text !== '') parser.feed(text)
  counter += 1
  const changed = !reuse || text !== ''
  return {
    path,
    parser,
    offset: start.offset + used,
    size,
    mtime,
    truncated: start.truncated,
    version: changed || !cached ? `${counter}` : cached.version,
    events: changed || !cached ? parser.events() : cached.events
  }
}

async function readWhole(path: string, size: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(size)
    const { bytesRead } = await handle.read(buffer, 0, size, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function load(request: TimelineRequest): Promise<TimelineResult> {
  try {
    const path = await pathFor(request, Date.now())
    if (!path) return { status: 'no-session' }
    const info = await stat(path)
    const key = keyOf(request)
    const mtime = Math.round(info.mtimeMs)
    let cached = parsed.get(key)
    if (!cached || cached.path !== path || cached.size !== info.size || cached.mtime !== mtime) {
      cached = await refresh(request, path, cached, info.size, mtime)
    }
    remember(parsed, key, cached)
    if (request.version !== undefined && request.version === `${key}#${cached.version}`) return { status: 'unchanged' }
    return { status: 'ok', events: cached.events, version: `${key}#${cached.version}`, truncated: cached.truncated }
  } catch {
    return { status: 'no-session' }
  }
}

/**
 * The session log's events. Claude and Codex logs only grow, so each call parses just the bytes added since
 * the last one; a log that shrank is read again from the start. Calls for one session run one at a time.
 */
export function sessionTimeline(request: TimelineRequest): Promise<TimelineResult> {
  if (request.agent === 'shell') return Promise.resolve({ status: 'no-session' })
  const key = keyOf(request)
  const next = (locks.get(key) ?? Promise.resolve()).then(() => load(request))
  const tail = next.catch(() => undefined)
  locks.set(key, tail)
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key)
  })
  return next
}

async function choosePath(window: BrowserWindow | null, name: string): Promise<string | null> {
  const override = process.env.DAWSHA_SAVE_PATH
  if (override) return override
  const options = {
    title: 'Export timeline',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export async function exportTimeline(window: BrowserWindow | null, request: TimelineExportRequest): Promise<TimelineExportResult> {
  try {
    if (typeof request?.name !== 'string' || typeof request.text !== 'string') return { status: 'error', message: 'The timeline export request was not valid.' }
    if (Buffer.byteLength(request.text, 'utf8') > TIMELINE_EXPORT_MAX) return { status: 'error', message: 'The timeline is too large to export.' }
    const name = basename(request.name.replace(/\\/g, '/')).replace(/[<>:"|?*\u0000-\u001f]/g, '-') || 'timeline.md'
    const path = await choosePath(window, name)
    if (!path) return { status: 'cancelled' }
    await writeFile(path, request.text, 'utf8')
    return { status: 'saved', path }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not write the timeline.' }
  }
}
