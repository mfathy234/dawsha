import type { ChatImageResult } from '../../shared/chatImage'
import type { TabAgent } from '../../shared/types'
import { api } from '../api'
import { LruCache } from './lruCache'

export interface ChatSessionRef {
  agent: TabAgent
  sessionId: string
}

const CACHE_ENTRIES = 24
const cache = new LruCache<ChatImageResult>(CACHE_ENTRIES)
const inflight = new Map<string, Promise<ChatImageResult>>()

const keyOf = (session: ChatSessionRef, imageId: string): string => `${session.agent}:${session.sessionId}:${imageId}`

/** A picture already fetched, so a thread drawn again shows it at once. */
export const cachedImage = (session: ChatSessionRef, imageId: string): ChatImageResult | undefined => cache.get(keyOf(session, imageId))

/** The picture for an id, fetched once however many places ask. A missing one is not remembered: the file may appear later. */
export function fetchImage(session: ChatSessionRef, imageId: string): Promise<ChatImageResult> {
  const key = keyOf(session, imageId)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(key)
  if (pending) return pending
  const request = api.chat
    .image({ agent: session.agent, sessionId: session.sessionId, imageId })
    .catch((): ChatImageResult => ({ status: 'missing' }))
    .then((result) => {
      inflight.delete(key)
      if (result.status !== 'missing') cache.set(key, result)
      return result
    })
  inflight.set(key, request)
  return request
}
