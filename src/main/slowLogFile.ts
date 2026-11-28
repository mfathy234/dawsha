import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SlowReport } from '../shared/slowLog'

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

const PROFILE_FILES_KEPT = 5
const PROFILE_PREFIX = 'dawsha-slow-'

const stamp = (now: Date): string => now.toISOString().replace(/[:.]/g, '-')

/** Saves what ran during a slow task as dawsha-slow-<time>.json next to the log and keeps the newest five; returns the file name, or null when it could not be written. */
export function writeSlowProfile(dir: string, details: unknown, now: Date = new Date()): string | null {
  try {
    mkdirSync(dir, { recursive: true })
    const name = `${PROFILE_PREFIX}${stamp(now)}.json`
    writeFileSync(join(dir, name), JSON.stringify(details, null, 2), 'utf8')
    const old = readdirSync(dir).filter((file) => file.startsWith(PROFILE_PREFIX) && file.endsWith('.json')).sort().slice(0, -PROFILE_FILES_KEPT)
    for (const file of old) unlinkSync(join(dir, file))
    return name
  } catch {
    return null
  }
}

/** The log line for a slow page task: its length, view and detail, the slowest steps, the top three functions and the file that holds the rest. */
export function slowPageLine(report: SlowReport, file: string | null): string {
  const phases = report.phases?.length ? `; slowest steps: ${report.phases.slice(0, 3).map((p) => `${p.name} ${p.ms} ms`).join(', ')}` : ''
  const top = report.profile?.self.slice(0, 3).map((f) => `${f.frame} ${f.ms} ms`).join(', ')
  const profile = top ? `; ran: ${top}` : ''
  const saved = file ? `; profile: ${file}` : ''
  return `page task ${Math.round(report.ms)} ms; view: ${String(report.view).slice(0, 40)}; ${String(report.detail).slice(0, 200)}${phases}${profile}${saved}`
}
