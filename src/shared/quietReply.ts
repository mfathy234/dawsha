import type { TurnSummary } from './turnSummary'

/** "Last reply edited 3 files", the words before the +added -removed counts of the Quiet pane's reply line. */
export function lastReplyWords(summary: Pick<TurnSummary, 'files'>): string {
  const count = summary.files.length
  return `Last reply edited ${count} ${count === 1 ? 'file' : 'files'}`
}

/** The reply the line talks about: the last agent message, and only when that very reply changed files. */
export function lastReplySummary(summaries: readonly TurnSummary[], lastAgentMessageId: string | null): TurnSummary | null {
  if (!lastAgentMessageId) return null
  return summaries.find((summary) => summary.messageId === lastAgentMessageId) ?? null
}

export interface PlanBadge {
  /** "5/7". */
  count: string
  /** 0 to 100. */
  percent: number
}

/** The pane header's plan count from the session note's "5 of 7". Null when there is no plan. */
export function planBadge(label: string): PlanBadge | null {
  const match = /^(\d+) of (\d+)$/.exec(label.trim())
  if (!match) return null
  const done = Number(match[1])
  const total = Number(match[2])
  if (total === 0) return null
  return { count: `${done}/${total}`, percent: Math.round((done / total) * 100) }
}
