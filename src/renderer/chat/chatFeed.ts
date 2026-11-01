import type { ChatItem, ChatReadRequest } from '../../shared/chatLog'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { api } from '../api'

export const CHAT_POLL_MS = 1000
const FAILED_POLL_MS = 4000

export type FeedState = 'loading' | 'empty' | 'ok' | 'failed'

export interface FeedSnapshot {
  state: FeedState
  items: readonly ChatItem[]
  earlier: number
  reason: string
}

export const LOADING: FeedSnapshot = { state: 'loading', items: [], earlier: 0, reason: '' }

/** Reads one session's log on a timer while its Chat view is on screen, and stops, releasing what main kept, when it is not. */
export class ChatFeed {
  private timer = 0
  private request: ChatReadRequest | null = null
  private version: string | undefined
  private generation = 0
  private snapshot: FeedSnapshot = LOADING

  constructor(
    private readonly onChange: (snapshot: FeedSnapshot) => void,
    private readonly onScreen: () => boolean = () => true
  ) {}

  get running(): boolean {
    return this.request !== null
  }

  start(request: ChatReadRequest): void {
    const same = this.request && this.request.agent === request.agent && this.request.sessionId === request.sessionId
    if (same) return
    this.stop()
    this.request = request
    this.snapshot = LOADING
    this.onChange(LOADING)
    this.schedule(0)
  }

  stop(): void {
    window.clearTimeout(this.timer)
    this.timer = 0
    this.generation += 1
    const request = this.request
    this.request = null
    this.version = undefined
    if (request) void api.chat.release({ agent: request.agent, sessionId: request.sessionId }).catch(() => undefined)
  }

  /** Read again soon, for after a message was sent. */
  nudge(): void {
    if (this.request) this.schedule(250)
  }

  private schedule(delay: number): void {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.tick(), delay)
  }

  private async tick(): Promise<void> {
    const request = this.request
    if (!request) return
    const generation = this.generation
    let next = CHAT_POLL_MS
    if (!this.onScreen()) {
      this.schedule(FAILED_POLL_MS)
      return
    }
    try {
      const result = await api.chat.read({ ...request, version: this.version })
      if (generation !== this.generation) return
      if (result.status === 'ok') {
        this.version = result.version
        this.publish({ state: result.items.length > 0 ? 'ok' : 'empty', items: result.items, earlier: result.earlier, reason: '' })
      } else if (result.status === 'no-session') {
        this.version = undefined
        this.publish({ state: 'empty', items: [], earlier: 0, reason: '' })
      } else if (result.status === 'failed') {
        next = FAILED_POLL_MS
        this.publish({ state: 'failed', items: [], earlier: 0, reason: result.reason })
      }
    } catch {
      if (generation !== this.generation) return
      next = FAILED_POLL_MS
      this.publish({ state: 'failed', items: [], earlier: 0, reason: CHAT_TEXT.failedRead })
    }
    if (generation === this.generation) this.schedule(document.hidden ? FAILED_POLL_MS : next)
  }

  private publish(snapshot: FeedSnapshot): void {
    this.snapshot = snapshot
    this.onChange(snapshot)
  }
}
