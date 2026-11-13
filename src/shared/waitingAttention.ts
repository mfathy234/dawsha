/** Compare identities, so one session replacing another still asks for attention. */
export function newlyWaiting(previous: readonly string[], current: readonly string[]): string[] {
  const known = new Set(previous)
  return [...new Set(current)].filter(id => !known.has(id))
}

/** Acknowledging a pane clears its badge, but the same unresolved prompt is still waiting. */
export function waitingSessionIds(sessions: ReadonlyArray<{ id: string; exited: boolean; waiting: boolean; attention: string }>): string[] {
  return sessions.filter(session => !session.exited && (session.waiting || session.attention === 'needs')).map(session => session.id)
}
