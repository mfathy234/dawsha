import type { WebContents } from 'electron'
import { summarizeProfile, type CpuProfile, type ProfileSummary } from '../shared/profileSummary'

const INTERVAL_US = 10_000
const ROTATE_MS = 20_000
const SLACK_MS = 400

/**
 * Samples a window's JavaScript all the time (every 10 ms through the debugger protocol; restarted every 20 s so the
 * profile stays small) so that when the page reports a slow task, the functions that ran during it are still known.
 */
export class PageSampler {
  private running = false
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly contents: WebContents) {}

  async start(): Promise<void> {
    if (this.running || this.contents.isDestroyed()) return
    try {
      if (!this.contents.debugger.isAttached()) this.contents.debugger.attach('1.3')
      await this.contents.debugger.sendCommand('Profiler.enable')
      await this.contents.debugger.sendCommand('Profiler.setSamplingInterval', { interval: INTERVAL_US })
      await this.contents.debugger.sendCommand('Profiler.start')
      this.running = true
      this.timer = setTimeout(() => void this.queue(() => this.restart()), ROTATE_MS)
      this.timer.unref()
    } catch {
      this.running = false
    }
  }

  /** What ran during a task that has just ended and took `ms`; sampling restarts either way. */
  summarize(ms: number): Promise<ProfileSummary | null> {
    return this.queue(async () => {
      const profile = await this.stop()
      await this.start()
      return profile ? summarizeProfile(profile, ms + SLACK_MS) : null
    })
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.running = false
    try {
      if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach()
    } catch {
      // The window is already gone.
    }
  }

  private async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  private queue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run)
    this.chain = next.catch(() => undefined)
    return next
  }

  private async stop(): Promise<CpuProfile | null> {
    if (this.timer) clearTimeout(this.timer)
    if (!this.running) return null
    this.running = false
    try {
      const result = (await this.contents.debugger.sendCommand('Profiler.stop')) as { profile: CpuProfile }
      return result.profile
    } catch {
      return null
    }
  }
}
