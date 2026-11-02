import { stat } from 'node:fs/promises'
import { chatCapable, type ChatReadRequest, type ChatReadResult, type ChatReleaseRequest } from '../../shared/chatLog'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { locateSession } from '../transcriptExport'
import type { ImageEntry } from './imageTable'
import { ChatSession } from './session'

const CACHE_LIMIT = 8
const MISS_TTL_MS = 1500

interface Entry {
  session: ChatSession
  path: string | null
  checkedAt: number
  /** The project folder the pane reads from: the root a picture file must lie in. */
  folder: string
}

const entries = new Map<string, Entry>()
const locks = new Map<string, Promise<unknown>>()

const keyOf = (agent: string, sessionId: string): string => `${agent}:${sessionId}`

function remember(key: string, entry: Entry): void {
  entries.delete(key)
  entries.set(key, entry)
  while (entries.size > CACHE_LIMIT) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

async function pathOf(request: ChatReadRequest, entry: Entry, now: number): Promise<string | null> {
  if (entry.path) {
    try {
      if ((await stat(entry.path)).isFile()) return entry.path
    } catch {
      entry.path = null
    }
  } else if (now - entry.checkedAt < MISS_TTL_MS) {
    return null
  }
  entry.checkedAt = now
  entry.path = (await locateSession(request))?.path ?? null
  return entry.path
}

async function load(request: ChatReadRequest): Promise<ChatReadResult> {
  const key = keyOf(request.agent, request.sessionId)
  const entry = entries.get(key) ?? { session: new ChatSession(request.agent), path: null, checkedAt: 0, folder: request.folder }
  entry.folder = request.folder
  remember(key, entry)
  try {
    const path = await pathOf(request, entry, Date.now())
    if (!path) return { status: 'no-session' }
    await entry.session.refresh(path)
    if (request.version !== undefined && request.version === `${key}#${entry.session.version}`) return { status: 'unchanged' }
    const result = entry.session.result()
    return result.status === 'ok' ? { ...result, version: `${key}#${result.version}` } : result
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const why = code === 'EACCES' || code === 'EPERM' ? CHAT_TEXT.failedDenied : CHAT_TEXT.failedRead
    return { status: 'failed', reason: why }
  }
}

/** The session log drawn as a conversation. Each call reads only what the file gained; calls for one session run one at a time. */
export function readChat(request: ChatReadRequest): Promise<ChatReadResult> {
  if (!chatCapable(request.agent) || typeof request.sessionId !== 'string' || typeof request.folder !== 'string') return Promise.resolve({ status: 'no-session' })
  const key = keyOf(request.agent, request.sessionId)
  const next = (locks.get(key) ?? Promise.resolve()).then(() => load(request))
  const tail = next.catch(() => undefined)
  locks.set(key, tail)
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key)
  })
  return next
}

/** The picture a session's reader made for an id, with the folder it must stay in. Only sessions already read have any. */
export function chatImageEntry(agent: string, sessionId: string, imageId: string): { entry: ImageEntry; folder: string } | null {
  if (typeof agent !== 'string' || typeof sessionId !== 'string' || typeof imageId !== 'string') return null
  const held = entries.get(keyOf(agent, sessionId))
  const entry = held?.session.image(imageId)
  return held && entry ? { entry, folder: held.folder } : null
}

/** The project folder of a session that has been read; the root a pasted or dropped file must lie in. */
export function chatFolder(agent: string, sessionId: string): string | null {
  if (typeof agent !== 'string' || typeof sessionId !== 'string') return null
  return entries.get(keyOf(agent, sessionId))?.folder ?? null
}

/** Drops what was read for a session once its pane closes or leaves the Chat view. */
export function releaseChat(request: ChatReleaseRequest): void {
  if (typeof request?.agent === 'string' && typeof request.sessionId === 'string') entries.delete(keyOf(request.agent, request.sessionId))
}
