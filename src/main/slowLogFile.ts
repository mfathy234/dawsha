import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const QUIET_MS = 10_000
const MAX_BYTES = 256 * 1024

/** Appends one line, keeping the file small: past 256 KB the old lines move to dawsha-slow.log.1. */
export function writeSlowLine(path: string, line: string, now: Date = new Date()): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    if (existsSync(path) && statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`)
    appendFileSync(path, `${now.toISOString()} ${line}\n`, 'utf8')
  } catch {
    // A log that cannot be written must never become a second problem.
  }
}

/** Says whether a slow moment may be logged now: one line per QUIET_MS across main and the page together. */
export function slowLogGate(quietMs = QUIET_MS): (now: number) => boolean {
  let last = -Infinity
  return (now) => {
    if (now - last < quietMs) return false
    last = now
    return true
  }
}
