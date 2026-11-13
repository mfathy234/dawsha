import type { MiniPlanRequest } from '../shared/miniWindow'
import { lastExchange, type MiniLogRead } from '../shared/miniDetail'
import { latestTodos } from '../shared/planProgress'
import { locateSession } from './transcriptExport'
import { ChatSession } from './chatLog/session'

/** Incremental readers owned by the visible Mini window: the plan, the last message sent and the last reply. They never evict the Chat view's readers. */
export class MiniPlans {
  private readers = new Map<string, { session: ChatSession; path: string | null; checked: number }>()
  private generation = 0

  clear(): void { this.generation += 1; this.readers.clear() }

  async read(requests: readonly MiniPlanRequest[]): Promise<Record<string, MiniLogRead>> {
    const generation = this.generation
    const live = new Set<string>()
    const result: Record<string, MiniLogRead> = {}
    for (const request of requests) {
      if (generation !== this.generation) return {}
      const key = JSON.stringify([request.paneId, request.agent, request.sessionId, request.folder])
      live.add(key)
      let held = this.readers.get(key)
      if (!held) {
        held = { session: new ChatSession(request.agent, undefined, request.folder), path: null, checked: 0 }
        this.readers.set(key, held)
      }
      try {
        if (!held.path && Date.now() - held.checked >= 1500) {
          held.checked = Date.now()
          held.path = (await locateSession(request))?.path ?? null
        }
        if (!held.path) continue
        await held.session.refresh(held.path)
        const snapshot = held.session.result()
        if (snapshot.status === 'ok') result[request.paneId] = { todos: latestTodos(snapshot.items), ...lastExchange(snapshot.items) }
      } catch {
        held.path = null
      }
    }
    if (generation !== this.generation) return {}
    for (const key of this.readers.keys()) if (!live.has(key)) this.readers.delete(key)
    return result
  }
}
