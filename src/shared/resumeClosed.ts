import { keptSessionKey } from './keptSessions'
import type { KeptSession, ResumeSession } from './types'
import { resolveSessionTitle } from './sessionTitle'

export const resumeKey = (session: Pick<ResumeSession, 'agent' | 'id'>): string => `${session.agent}:${session.id}`

/** The closed (kept, not open) entry behind a Resume row, or undefined when the row is not a closed session. */
export function closedFor(
  session: Pick<ResumeSession, 'agent' | 'id'>,
  kept: readonly KeptSession[],
  openKeys: ReadonlySet<string>
): KeptSession | undefined {
  const key = resumeKey(session)
  return openKeys.has(key) ? undefined : kept.find((item) => keptSessionKey(item) === key)
}

/** What a closed session is called in the list: the name the user gave it, else the agent's own title. */
export const closedTitle = (session: ResumeSession, kept: KeptSession | undefined): string =>
  resolveSessionTitle({ name: session.title, nameSource: session.nameSource, firstPrompt: session.firstPrompt,
    renamed: kept?.renamed ? kept.title : undefined, agent: session.agent, index: 1 }).title

/** The text Rename starts with: the name in use, or the whole first message when the title was shortened from it. */
export const closedRenameText = (session: ResumeSession, kept: KeptSession | undefined): string =>
  resolveSessionTitle({ name: session.title, nameSource: session.nameSource, firstPrompt: session.firstPrompt,
    renamed: kept?.renamed ? kept.title : undefined, agent: session.agent, index: 1 }).renameText

/**
 * The closed sessions "Reopen all" would start for one day group. It only applies to one project at a time,
 * so a group that mixes projects (All projects) has no single target and gives null.
 */
export function reopenTargets(
  group: readonly ResumeSession[],
  kept: readonly KeptSession[],
  openKeys: ReadonlySet<string>
): { projectId: string; sessions: KeptSession[] } | null {
  const closed = group.flatMap((session) => {
    const entry = closedFor(session, kept, openKeys)
    return entry ? [entry] : []
  })
  const projectId = closed[0]?.projectId
  if (!projectId || closed.length < 2 || closed.some((item) => item.projectId !== projectId)) return null
  return { projectId, sessions: closed }
}

export const reopenAllLabel = (count: number, day: string, project: string): string =>
  `Reopen ${count} closed session${count === 1 ? '' : 's'} from ${day} in ${project}`
