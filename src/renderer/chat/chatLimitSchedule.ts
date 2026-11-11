import { clockTime, resetNotice } from '../../shared/chatLimit'

/** Reminders for a usage limit's reset, one per reset time. They live as long as the app is open. */
export class LimitReminders {
  private readonly timers = new Map<number, number>()

  has(at: number): boolean {
    return this.timers.has(at)
  }

  get size(): number {
    return this.timers.size
  }

  /** Calls `notify` at the reset time. Returns the time shown to the user. */
  set(at: number, agentName: string, notify: (title: string, body: string) => void, now: number = Date.now()): string {
    if (!this.timers.has(at)) {
      const message = resetNotice(agentName)
      this.timers.set(at, window.setTimeout(() => {
        this.timers.delete(at)
        notify(message.title, message.body)
      }, Math.max(0, at - now)))
    }
    return clockTime(at)
  }

  dispose(): void {
    this.timers.forEach((timer) => window.clearTimeout(timer))
    this.timers.clear()
  }
}
