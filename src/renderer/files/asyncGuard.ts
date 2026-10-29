export interface Ticket {
  /** False once a newer load began or the gate was cancelled: the result must be dropped. */
  current(): boolean
}

/** Keeps only the newest of a series of async loads: begin() before the await, ticket.current() after it. */
export class LatestGate {
  private latest = 0

  begin(): Ticket {
    const mine = ++this.latest
    return { current: () => mine === this.latest }
  }

  /** Makes every ticket handed out so far stale (the view moved away or closed). */
  cancel(): void {
    this.latest += 1
  }
}

/** One gate per key (a checkout, a file): loads for different keys never invalidate each other. */
export class KeyedGate<K> {
  private readonly gates = new Map<K, LatestGate>()

  begin(key: K): Ticket {
    let gate = this.gates.get(key)
    if (!gate) {
      gate = new LatestGate()
      this.gates.set(key, gate)
    }
    return gate.begin()
  }

  cancel(key: K): void {
    this.gates.get(key)?.cancel()
    this.gates.delete(key)
  }
}

/** Runs at most one load per key at a time; a second request for the same key shares the first one's promise. */
export class InFlight<K> {
  private readonly running = new Map<K, Promise<void>>()

  run(key: K, load: () => Promise<void>): Promise<void> {
    const known = this.running.get(key)
    if (known) return known
    const started = load().finally(() => {
      if (this.running.get(key) === started) this.running.delete(key)
    })
    this.running.set(key, started)
    return started
  }

  has(key: K): boolean {
    return this.running.has(key)
  }
}
