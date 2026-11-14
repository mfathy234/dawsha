/** A session the Mini window can hide: its pane, and the agent session running in it when that is known. */
export interface MiniTarget { paneId: string; sessionId: string }

const HIDDEN_MAX = 200
const SEP = '|'

export const hiddenKey = (target: MiniTarget): string => target.sessionId ? `${target.paneId}${SEP}${target.sessionId}` : target.paneId

const split = (key: string): MiniTarget => {
  const at = key.indexOf(SEP)
  return at < 0 ? { paneId: key, sessionId: '' } : { paneId: key.slice(0, at), sessionId: key.slice(at + 1) }
}

/** An entry made before the session id was known hides the pane's session whatever its id turns out to be. */
function matches(key: string, target: MiniTarget): boolean {
  const entry = split(key)
  return entry.paneId === target.paneId && (entry.sessionId === '' || entry.sessionId === target.sessionId)
}

export const isMiniHidden = (hidden: readonly string[], target: MiniTarget): boolean => hidden.some(key => matches(key, target))

/** One entry per pane: hiding a pane's newer session replaces the entry of its older one. */
export function hideMiniSession(hidden: readonly string[], target: MiniTarget): string[] {
  const kept = hidden.filter(key => split(key).paneId !== target.paneId)
  return [...kept, hiddenKey(target)].slice(-HIDDEN_MAX)
}

export interface MiniListed extends MiniTarget { state: string }

/**
 * The rule that keeps monitoring honest, with no setting: a session that needs you is never hidden. Its entry is dropped
 * the moment it needs you, so it stays in the list after you answer. Entries of panes that no longer exist are dropped too.
 */
export function reconcileMiniHidden(hidden: readonly string[], sessions: readonly MiniListed[]): string[] {
  const next = hidden.filter(key => {
    const entry = split(key)
    const pane = sessions.find(session => session.paneId === entry.paneId)
    return !!pane && !(pane.state === 'needs' && matches(key, pane))
  })
  return next.length === hidden.length ? [...hidden] : next
}

/** The sessions to list, and how many are hidden. A session that needs you always shows. */
export function splitMiniHidden<T extends MiniListed>(hidden: readonly string[], sessions: readonly T[]): { shown: T[]; hiddenCount: number } {
  const shown = sessions.filter(session => session.state === 'needs' || !isMiniHidden(hidden, session))
  return { shown, hiddenCount: sessions.length - shown.length }
}
