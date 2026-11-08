import { stat } from 'node:fs/promises'
import { chatCapable, type ChatItem, type ChatReadRequest, type ChatReadResult, type ChatReleaseRequest } from '../../shared/chatLog'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { locateSession } from '../transcriptExport'
import type { ImageEntry } from './imageTable'
import { ChatSession } from './session'
import { storeCheckpoint } from '../checkpoints'

const CACHE_LIMIT = 8
const MISS_TTL_MS = 1500

interface Entry {
  session: ChatSession
  path: string | null
  checkedAt: number
  /** The project folder the pane reads from: the root a picture file must lie in. */
  folder: string
  lastUserId: string | null
  /** When the latest user message was first seen; a pending snapshot older than this is late. */
  lastUserSeenAt: number
}

const entries = new Map<string, Entry>()
const locks = new Map<string, Promise<unknown>>()
const workingSessions = new Set<string>()

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
  const entry = entries.get(key) ?? { session: new ChatSession(request.agent, undefined, request.folder), path: null, checkedAt: 0, folder: request.folder, lastUserId: null, lastUserSeenAt: 0 }
  entry.folder = request.folder
  remember(key, entry)
  try {
    const path = await pathOf(request, entry, Date.now())
    if (!path) return { status: 'no-session' }
    await entry.session.refresh(path)
    if (request.version !== undefined && request.version === `${key}#${entry.session.version}`) return { status: 'unchanged' }
    const result = entry.session.result()
    if (result.status === 'ok') await trackUserTurn(entry, request, result.items)
    return result.status === 'ok' ? { ...result, version: `${key}#${result.version}` } : result
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const why = code === 'EACCES' || code === 'EPERM' ? CHAT_TEXT.failedDenied : CHAT_TEXT.failedRead
    return { status: 'failed', reason: why }
  }
}

/**
 * Notices a new user message and files the snapshot the pane took just before sending it under that message's id.
 * The first message seen is only adopted, except in a session with exactly one user message and a fresh snapshot
 * (its first turn). Also tracks whether the agent has answered, for the Undo refusal.
 */
async function trackUserTurn(entry: Entry, request: ChatReadRequest, items: readonly ChatItem[]): Promise<void> {
  const users = items.filter((item) => item.kind === 'message' && item.role === 'user')
  const lastUser = users[users.length - 1]
  if (lastUser && lastUser.id !== entry.lastUserId) {
    const first = entry.lastUserId === null
    const seenAfter = entry.lastUserSeenAt
    entry.lastUserId = lastUser.id
    entry.lastUserSeenAt = Date.now()
    if (!first || users.length === 1) {
      workingSessions.add(request.sessionId)
      await storeCheckpoint(request.folder, request.sessionId, lastUser.id, seenAfter)
    }
  }
  const userAt = items.findIndex((item) => item.kind === 'message' && item.id === entry.lastUserId)
  if (userAt >= 0 && items.slice(userAt + 1).some((item) => item.kind === 'message' && item.role === 'agent')) workingSessions.delete(request.sessionId)
}

export const isChatSessionWorking = (sessionId: string): boolean => workingSessions.has(sessionId)

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
