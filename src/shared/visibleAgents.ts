import { AGENTS } from './agents'
import type { ToolReport } from './agentTools'
import type { AgentKind, TabAgent } from './types'

export interface VisibleAgentsInput {
  /** The install check, or null while it has not returned yet. */
  report: readonly ToolReport[] | null
  /** Agents with a limit reading (or usage history, in the Usage view). */
  withData: readonly AgentKind[]
  /** Agents with a signed-in account, when known. */
  signedIn: readonly AgentKind[]
  /** The agent of the focused session; it always shows, even when the check says it is not installed. */
  focused: TabAgent | null
}

/**
 * Which agents the limits pill, the "Limits by agent" popover and the Usage view list.
 * An installed agent shows. One known not to be installed is hidden, whatever old data it has, unless it is the focused session's agent.
 * Until the install check returns, only agents with data or a signed-in account show, so nothing flickers in and out.
 * Stored readings and history are never deleted; they are just not listed.
 */
export function visibleLimitAgents(input: VisibleAgentsInput): AgentKind[] {
  const { report, withData, signedIn, focused } = input
  return AGENTS.filter((agent) => {
    if (agent === focused) return true
    if (!report) return withData.includes(agent) || signedIn.includes(agent)
    const tool = report.find((entry) => entry.agent === agent)
    return tool ? tool.present : withData.includes(agent) || signedIn.includes(agent)
  })
}
