const KEEP_MS = 30_000
const MAX_ENTRIES = 40
const MIN_MS = 20

interface Phase {
  name: string
  ms: number
  at: number
}

let phases: Phase[] = []

/** Runs one named step of the page's work and remembers how long it took, so a slow task can say which step it was. */
export function timed<T>(name: string, run: () => T): T {
  const start = performance.now()
  try {
    return run()
  } finally {
    const ms = performance.now() - start
    if (ms >= MIN_MS) {
      phases.push({ name, ms, at: start })
      if (phases.length > MAX_ENTRIES) phases = phases.slice(-MAX_ENTRIES)
    }
  }
}

/** The slowest steps of the last half minute, longest first. */
export function slowestPhases(now = performance.now(), count = 5): { name: string; ms: number }[] {
  phases = phases.filter((phase) => now - phase.at <= KEEP_MS)
  return [...phases].sort((a, b) => b.ms - a.ms).slice(0, count).map(({ name, ms }) => ({ name, ms: Math.round(ms) }))
}
