/** What each pane has noticed about its session, for the sidebar's second line. */
export interface SessionNote {
  /** The agent's own recap read off its screen. */
  recap: string
  /** Its last tool call as a phrase. */
  tool: string
  /** "3 of 7" while the chat log has an active plan. */
  plan: string
}

const EMPTY: SessionNote = { recap: '', tool: '', plan: '' }

let notes: ReadonlyMap<string, SessionNote> = new Map()
let version = 0

export const sessionNote = (paneId: string): SessionNote => notes.get(paneId) ?? EMPTY

/** Changes whenever any note does, so the sidebar knows to redraw. */
export const sessionNotesVersion = (): number => version

export function setSessionNote(paneId: string, patch: Partial<SessionNote>): void {
  const current = sessionNote(paneId)
  const next: SessionNote = { ...current, ...patch }
  if (next.recap === current.recap && next.tool === current.tool && next.plan === current.plan) return
  notes = new Map(notes).set(paneId, next)
  version += 1
}

export function forgetSessionNotes(liveIds: ReadonlySet<string>): void {
  const kept = [...notes].filter(([id]) => liveIds.has(id))
  if (kept.length === notes.size) return
  notes = new Map(kept)
  version += 1
}
