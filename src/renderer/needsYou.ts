const HOLD_MS = 90_000

const marked = new Map<string, number>()

/** A watched word asked for this session's attention: it counts as waiting for a little while. */
export function markNeedsYou(paneId: string, now = Date.now()): void {
  marked.set(paneId, now + HOLD_MS)
}

/** The sessions still marked, with finished and closed ones dropped. */
export function markedNeedsYou(open: (paneId: string) => boolean, now = Date.now()): string[] {
  for (const [paneId, until] of marked) if (until < now || !open(paneId)) marked.delete(paneId)
  return [...marked.keys()]
}
