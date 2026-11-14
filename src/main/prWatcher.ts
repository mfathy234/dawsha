import { classifyGhFailure } from '../shared/prFlow'
import {
  DISCOVER_MS,
  POLL_HIDDEN_MS,
  PR_FIELDS,
  isDue,
  parseWatchedPr,
  pollDelayMs,
  worthLooking,
  type PrWatchState,
  type PrWatchTarget,
  type PrWatchUpdate,
  type WatchSchedule
} from '../shared/prWatch'
import type { GhRun } from './ghRunner'

const TICK_MS = 5_000
const UNAVAILABLE_MS = 30 * 60_000
const MAX_TARGETS = 200

export interface WatcherDeps {
  runGh(cwd: string, args: readonly string[], timeout?: number): Promise<GhRun>
  now(): number
  visible(): boolean
  emit(update: PrWatchUpdate): void
  known(folder: string): Promise<string | null>
}

interface Entry extends WatchSchedule {
  key: string
  folder: string
  number: number | null
  failures: number
  lastPollAt: number
  shown: string
}

/** Polls the pull request of each watched session: one gh call per entry at a time, slower while the window is hidden, slower again after failures. */
export class PrWatcher {
  private readonly entries = new Map<string, Entry>()
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false

  constructor(private readonly deps: WatcherDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async sync(targets: readonly PrWatchTarget[]): Promise<void> {
    const wanted = new Map<string, { target: PrWatchTarget; folder: string }>()
    for (const target of targets.slice(0, MAX_TARGETS)) {
      const folder = await this.deps.known(target.folder)
      if (folder) wanted.set(target.key, { target, folder })
    }
    for (const key of [...this.entries.keys()]) if (!wanted.has(key)) this.entries.delete(key)
    for (const { target, folder } of wanted.values()) {
      const earlier = this.entries.get(target.key)
      if (earlier && earlier.folder === folder && (target.number === null || earlier.number === target.number)) continue
      this.entries.set(target.key, {
        key: target.key, folder, number: target.number, nextAt: 0, inFlight: false, done: false, failures: 0, lastPollAt: -Infinity,
        shown: earlier && earlier.folder === folder ? earlier.shown : 'null'
      })
    }
  }

  refresh(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.nextAt = 0
    entry.done = false
  }

  size(): number {
    return this.entries.size
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const now = this.deps.now()
      const visible = this.deps.visible()
      const due = [...this.entries.values()].filter((entry) => isDue(entry, now) && (visible || now - entry.lastPollAt >= POLL_HIDDEN_MS))
      const claimed = new Set<string>()
      const work: Promise<void>[] = []
      for (const entry of due) {
        const gate = `${entry.folder}#${entry.number ?? ''}`
        if (claimed.has(gate)) continue
        claimed.add(gate)
        work.push(this.poll(entry, visible))
      }
      await Promise.all(work)
    } finally {
      this.running = false
    }
  }

  private show(entry: Entry, state: PrWatchState | null): void {
    const signature = JSON.stringify(state)
    if (signature === entry.shown) return
    entry.shown = signature
    this.deps.emit({ key: entry.key, state })
  }

  private async poll(entry: Entry, visible: boolean): Promise<void> {
    entry.inFlight = true
    entry.lastPollAt = this.deps.now()
    try {
      const args = ['pr', 'view', ...(entry.number === null ? [] : [String(entry.number)]), '--json', PR_FIELDS]
      const run = await this.deps.runGh(entry.folder, args)
      this.settle(entry, run, visible)
    } catch {
      this.fail(entry, visible)
    } finally {
      entry.inFlight = false
    }
  }

  private fail(entry: Entry, visible: boolean): void {
    entry.failures += 1
    entry.nextAt = this.deps.now() + pollDelayMs({ visible, failures: entry.failures })
  }

  private settle(entry: Entry, run: GhRun, visible: boolean): void {
    const now = this.deps.now()
    if (run.missing) {
      entry.nextAt = now + UNAVAILABLE_MS
      this.show(entry, null)
      return
    }
    const state = run.ok ? parseWatchedPr(run.stdout) : null
    if (state && (entry.number !== null || worthLooking(state.headRef))) {
      entry.failures = 0
      entry.number = state.number
      entry.done = state.phase === 'merged' || state.phase === 'closed'
      entry.nextAt = now + pollDelayMs({ visible, failures: 0 })
      this.show(entry, state)
      return
    }
    const problem = run.ok ? 'no-pr' : classifyGhFailure(run.message)
    if (problem === 'no-pr') {
      entry.nextAt = now + (entry.number === null ? DISCOVER_MS : pollDelayMs({ visible, failures: 0 }))
      if (entry.number === null) this.show(entry, null)
      return
    }
    if (problem) {
      entry.nextAt = now + UNAVAILABLE_MS
      this.show(entry, null)
      return
    }
    this.fail(entry, visible)
  }
}
