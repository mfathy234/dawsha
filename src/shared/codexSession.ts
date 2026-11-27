import type { CodexSession, SessionStatus } from './types'
import { normalizePath } from './sessionMatch'

const FALLBACK_GRACE_MS = 5000
const STALE_OPEN_TURN_MS = 10 * 60 * 1000
const UNMARKED_BUSY_MS = 30_000
const TURN_MARKER = /"type":"event_msg","payload":\{"type":"(task_started|task_complete|turn_aborted)"/g
const ROLLOUT_NAME = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

export interface RolloutMeta {
  sessionId: string
  cwd: string
  startedAt: number
}

export interface CodexTermRef {
  id: string
  cwd: string
  startedAt: number
  sessionId?: string
}

export const rolloutIdFromName = (fileName: string): string | null => ROLLOUT_NAME.exec(fileName)?.[1] ?? null

export function parseRolloutMeta(firstLine: string): RolloutMeta | null {
  try {
    const raw = JSON.parse(firstLine) as Record<string, unknown>
    if (raw.type !== 'session_meta' || typeof raw.payload !== 'object' || raw.payload === null) return null
    const meta = raw.payload as Record<string, unknown>
    const sessionId = typeof meta.id === 'string' ? meta.id : null
    const cwd = typeof meta.cwd === 'string' ? meta.cwd : null
    const startedAt = typeof meta.timestamp === 'string' ? Date.parse(meta.timestamp) : Number.NaN
    if (!sessionId || !cwd || Number.isNaN(startedAt)) return null
    return { sessionId, cwd, startedAt }
  } catch {
    return null
  }
}

export function parseSessionIndex(text: string): Map<string, string> {
  const names = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const raw = JSON.parse(line) as Record<string, unknown>
      const name = typeof raw.thread_name === 'string' ? raw.thread_name.trim() : ''
      if (typeof raw.id === 'string' && name) names.set(raw.id, name)
    } catch {
      continue
    }
  }
  return names
}

/** The last turn marker in a rollout's tail ("task_started", "task_complete"...), or null when it has none. */
export function lastTurnMarker(tail: string): string | null {
  let last: string | null = null
  for (const match of tail.matchAll(TURN_MARKER)) last = match[1]
  return last
}

export const codexStatusFromTail = (tail: string, modifiedAt: number, now: number): SessionStatus =>
  codexStatusFromMarker(lastTurnMarker(tail), modifiedAt, now)

export function codexStatusFromMarker(last: string | null, modifiedAt: number, now: number): SessionStatus {
  const age = now - modifiedAt
  if (last === null) return age < UNMARKED_BUSY_MS ? 'busy' : 'idle'
  return last === 'task_started' && age < STALE_OPEN_TURN_MS ? 'busy' : 'idle'
}

export function matchCodexSessions(terms: CodexTermRef[], sessions: CodexSession[]): Map<string, CodexSession> {
  const result = new Map<string, CodexSession>()
  const claimed = new Set<string>()
  for (const term of terms) {
    const hit = term.sessionId ? sessions.find((s) => s.sessionId === term.sessionId) : undefined
    if (hit) {
      result.set(term.id, hit)
      claimed.add(hit.sessionId)
    } else if (term.sessionId) {
      claimed.add(term.sessionId)
    }
  }
  const pending = terms.filter((t) => !t.sessionId).sort((a, b) => a.startedAt - b.startedAt)
  for (const term of pending) {
    const cwd = normalizePath(term.cwd)
    const best = sessions
      .filter((s) => !claimed.has(s.sessionId) && normalizePath(s.cwd) === cwd)
      .filter((s) => s.startedAt >= term.startedAt - FALLBACK_GRACE_MS)
      .sort((a, b) => Math.abs(a.startedAt - term.startedAt) - Math.abs(b.startedAt - term.startedAt))[0]
    if (best) {
      result.set(term.id, best)
      claimed.add(best.sessionId)
    }
  }
  return result
}

export interface CodexInfo {
  model?: string
  contextPercent?: number
}

const LAST_USAGE = /"last_token_usage":\{[^}]*?"total_tokens":(\d+)/
const CONTEXT_WINDOW = /"model_context_window":(\d+)/
const MODEL = /"model":"([^"]+)"/

export function codexInfoFromTail(tail: string): CodexInfo {
  const info: CodexInfo = {}
  let used: number | undefined
  let window: number | undefined
  for (const line of tail.split('\n')) {
    if (line.includes('"type":"turn_context"')) {
      const model = MODEL.exec(line)?.[1]
      if (model) info.model = model
    } else if (line.includes('"type":"token_count"')) {
      const usage = LAST_USAGE.exec(line)?.[1]
      const size = CONTEXT_WINDOW.exec(line)?.[1]
      if (usage && size) {
        used = Number(usage)
        window = Number(size)
      }
    }
  }
  if (used !== undefined && window) info.contextPercent = Math.min(100, Math.round((used / window) * 100))
  return info
}
