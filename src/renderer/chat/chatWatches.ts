import type { ChatPhase } from '../../shared/chatLog'
import { settleWatches } from '../../shared/chatNotify'

/** The agent can look idle for a moment between steps; a turn counts as finished only when it stays idle this long. */
export const WATCH_CONFIRM_MS = 1500

/** The user messages someone asked to be told about when their turn finishes. Per message, kept only while the pane is open. */
export class ChatWatches {
  private ids: readonly string[] = []
  private timer = 0

  constructor(
    private readonly phase: () => ChatPhase,
    private readonly fire: (ids: readonly string[]) => void
  ) {}

  get watched(): ReadonlySet<string> {
    return new Set(this.ids)
  }

  toggle(id: string): void {
    this.ids = this.ids.includes(id) ? this.ids.filter((entry) => entry !== id) : [...this.ids, id]
  }

  /** Called after each draw: when the turn has stopped running, waits a moment and then tells the person. */
  check(): void {
    if (this.ids.length === 0 || this.timer !== 0) return
    if (settleWatches(this.ids, this.phase()).finished.length === 0) return
    this.timer = window.setTimeout(() => {
      this.timer = 0
      const { keep, finished } = settleWatches(this.ids, this.phase())
      if (finished.length === 0) return
      this.ids = keep
      this.fire(finished)
    }, WATCH_CONFIRM_MS)
  }

  dispose(): void {
    window.clearTimeout(this.timer)
    this.timer = 0
    this.ids = []
  }
}
