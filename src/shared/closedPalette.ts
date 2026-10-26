import { AGENT_NAMES } from './agents'
import { closedAgoShort, keptSessionKey } from './keptSessions'
import type { PaletteItem } from './palette'
import type { KeptSession } from './types'

export const CLOSED_GROUP = 'Closed sessions'
/** Browsing the palette shows this many; the rest are found by typing. */
export const CLOSED_BROWSE_LIMIT = 8

export interface ClosedPaletteItem extends PaletteItem {
  hint: string
  session: KeptSession
}

/** Closed sessions of known projects that are not open again, newest first. */
export function closedPaletteItems(
  kept: readonly KeptSession[],
  projects: readonly { id: string; name: string }[],
  openKeys: ReadonlySet<string>,
  now: number
): ClosedPaletteItem[] {
  const names = new Map(projects.map((project) => [project.id, project.name]))
  const seen = new Set<string>()
  return [...kept]
    .sort((a, b) => b.closedAt - a.closedAt)
    .filter((session) => {
      const key = keptSessionKey(session)
      if (!names.has(session.projectId) || openKeys.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((session, index) => {
      const project = names.get(session.projectId) as string
      return {
        id: `closed:${keptSessionKey(session)}`,
        title: session.title,
        group: CLOSED_GROUP,
        hint: `${project} · ${closedAgoShort(session.closedAt, now)}`,
        keywords: `${project} ${AGENT_NAMES[session.agent]}`,
        searchOnly: index >= CLOSED_BROWSE_LIMIT,
        session
      }
    })
}
