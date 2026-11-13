import { normalizeFolder } from './folderKey'
import type { SnapshotTab } from './layouts'
import type { TabAgent } from './types'

type MatchMap = ReadonlyMap<string, { sessionId: string }> | undefined

export interface AgentMatches {
  claude?: MatchMap
  codex?: MatchMap
  gemini?: MatchMap
}

/**
 * The conversation to save for each tab. Claude tabs rarely carry an id of their own (only ones picked from
 * Resume do), so the session file matched to the running process is the truth, and it also follows /clear.
 * Codex and Gemini tabs keep the id they were started or resumed with.
 */
export function workspaceSessionFor(matches: AgentMatches): (tab: SnapshotTab) => string | undefined {
  return (tab) => {
    if (tab.agent === 'shell') return undefined
    const matched = matches[tab.agent]?.get(tab.id)?.sessionId
    return tab.agent === 'claude' ? (matched ?? tab.sessionId) : (tab.sessionId ?? matched)
  }
}

export interface RestoreTab {
  agent: TabAgent
  sessionId?: string
  folder: string
}

/**
 * Whether each restored tab resumes. A Claude tab without an id resumes with --continue, the latest
 * conversation in its folder, so only one such tab per folder may do it; the others start fresh rather
 * than all opening the same conversation.
 */
export function restoreResumeFlags(tabs: readonly RestoreTab[]): boolean[] {
  const continued = new Set<string>()
  return tabs.map((tab) => {
    if (tab.agent === 'shell') return false
    if (tab.sessionId) return true
    if (tab.agent !== 'claude') return false
    const key = normalizeFolder(tab.folder)
    if (continued.has(key)) return false
    continued.add(key)
    return true
  })
}

/** A stable key of which conversation each tab is matched to, to save the workspace only when it changes. */
export function matchSignature(matches: MatchMap): string {
  if (!matches) return ''
  return [...matches.entries()]
    .map(([tabId, match]) => `${tabId}=${match.sessionId}`)
    .sort()
    .join('|')
}
