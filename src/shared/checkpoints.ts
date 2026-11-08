export const MAX_SESSION_CHECKPOINTS = 30
export const MAX_SESSION_UNDOS = 10

const SESSION = /^[a-zA-Z0-9_-]{1,128}$/
const KEY = /^[0-9a-f]{16}$/

export const checkpointPrefix = (sessionId: string): string => `refs/dawsha/checkpoints/${sessionId}/`
export const undoPrefix = (sessionId: string): string => `refs/dawsha/undo/${sessionId}/`

const safeSession = (sessionId: unknown): sessionId is string => typeof sessionId === 'string' && SESSION.test(sessionId)

/** The private ref holding the snapshot taken just before one user message; `key` is the hash of that message's id. */
export function checkpointRef(sessionId: unknown, key: unknown): string | null {
  return safeSession(sessionId) && typeof key === 'string' && KEY.test(key) ? `${checkpointPrefix(sessionId)}${key}` : null
}

/** A "before undo" snapshot, kept apart so it can never be mistaken for a turn's checkpoint. */
export function undoRef(sessionId: unknown, number: unknown): string | null {
  return safeSession(sessionId) && Number.isSafeInteger(number) && (number as number) >= 1 ? `${undoPrefix(sessionId)}${number}` : null
}

export function validCheckpointRef(sessionId: unknown, ref: unknown): ref is string {
  return safeSession(sessionId) && typeof ref === 'string' && ref.startsWith(checkpointPrefix(sessionId)) && KEY.test(ref.slice(checkpointPrefix(sessionId).length))
}

export function validUndoRef(sessionId: unknown, ref: unknown): ref is string {
  return safeSession(sessionId) && typeof ref === 'string' && ref.startsWith(undoPrefix(sessionId)) && /^[1-9][0-9]*$/.test(ref.slice(undoPrefix(sessionId).length))
}

export function nextUndoNumber(refs: readonly string[], sessionId: string): number {
  const prefix = undoPrefix(sessionId)
  return refs.reduce((max, ref) => {
    const value = ref.startsWith(prefix) ? Number(ref.slice(prefix.length)) : 0
    return Number.isSafeInteger(value) && value > max ? value : max
  }, 0) + 1
}

/** `refs` is ordered oldest first; returns the ones beyond the newest `keep`. */
export function refsToPrune(refs: readonly string[], keep: number): string[] {
  return refs.slice(0, Math.max(0, refs.length - keep))
}
