import type { DiagramResult } from '../shared/diagrams'

type Work = (signal: AbortSignal) => Promise<DiagramResult>
interface Pending {
  key: string
  revision: number
  work: Work
  resolve(result: DiagramResult): void
}

const superseded = (): DiagramResult => ({ ok: false, error: 'A newer diagram is waiting', reason: 'superseded' })

/** A single child at a time; replacing pending work keeps its place in the queue. */
export class DiagramQueue {
  private readonly pending = new Map<string, Pending>()
  private readonly revisions = new Map<string, number>()
  private running = false

  constructor(private readonly timeoutMs = 20_000) {}

  render(key: string, work: Work): Promise<DiagramResult> {
    const revision = (this.revisions.get(key) ?? 0) + 1
    this.revisions.set(key, revision)
    return new Promise(resolve => {
      this.pending.get(key)?.resolve(superseded())
      this.pending.set(key, { key, revision, work, resolve })
      void this.pump()
    })
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    while (this.pending.size) {
      const item = this.pending.values().next().value!
      this.pending.delete(item.key)
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, this.timeoutMs)
      let result: DiagramResult
      try {
        result = await item.work(controller.signal)
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error), reason: 'render' }
      } finally {
        clearTimeout(timer)
      }
      if (timedOut) result = { ok: false, error: 'Drawing this diagram timed out after 20 seconds', reason: 'render' }
      if (this.revisions.get(item.key) !== item.revision) result = superseded()
      else this.revisions.delete(item.key)
      item.resolve(result)
    }
    this.running = false
  }
}
