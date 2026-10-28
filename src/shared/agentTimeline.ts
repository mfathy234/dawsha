import type { BgSessionGroup, BgStatus } from './backgroundAgents'

export interface TimelineLane {
  kind: 'session' | 'agent'
  key: string
  /** Session lanes carry the group's title; agent lanes the description. */
  title: string
  status: BgStatus | null
  /** Percent of the shared axis. */
  left: number
  width: number
  startedAt: number
  endedAt: number
}

export interface TimelineTick {
  at: number
  left: number
}

export interface Timeline {
  start: number
  end: number
  ticks: TimelineTick[]
  lanes: TimelineLane[]
}

const MIN_SPAN_MS = 60_000
const MIN_BAR_PERCENT = 0.8
const TARGET_TICKS = 6
const MINUTE = 60_000
const STEPS = [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, 60 * MINUTE, 2 * 60 * MINUTE, 3 * 60 * MINUTE, 6 * 60 * MINUTE, 12 * 60 * MINUTE, 24 * 60 * MINUTE, 48 * 60 * MINUTE]

/** The smallest readable tick step that keeps about six ticks on the axis. */
export const niceStep = (spanMs: number): number => STEPS.find((step) => step >= spanMs / TARGET_TICKS) ?? STEPS[STEPS.length - 1]

const endOf = (agent: { status: BgStatus; endedAt: number | null; lastActivityAt: number }, now: number): number => (agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt)

/** One session lane then one lane per agent, all on one axis from the earliest start to the latest end (now, while anything runs). */
export function layoutTimeline(groups: readonly BgSessionGroup[], now: number): Timeline {
  const agents = groups.flatMap((group) => group.agents)
  if (agents.length === 0) return { start: now, end: now, ticks: [], lanes: [] }
  const start = Math.min(...agents.map((agent) => agent.startedAt))
  const end = Math.max(start + MIN_SPAN_MS, ...agents.map((agent) => endOf(agent, now)))
  const span = end - start
  const place = (from: number, to: number): { left: number; width: number } => {
    const left = ((from - start) / span) * 100
    const width = Math.max(MIN_BAR_PERCENT, ((Math.max(to, from) - from) / span) * 100)
    return { left: Math.min(left, 100 - width), width }
  }
  const lanes: TimelineLane[] = []
  for (const group of groups) {
    const from = Math.min(...group.agents.map((agent) => agent.startedAt))
    const to = Math.max(...group.agents.map((agent) => endOf(agent, now)))
    lanes.push({ kind: 'session', key: group.sessionKey, title: group.title, status: null, ...place(from, to), startedAt: from, endedAt: to })
    for (const agent of group.agents) {
      const stop = endOf(agent, now)
      lanes.push({ kind: 'agent', key: agent.key, title: agent.description, status: agent.status, ...place(agent.startedAt, stop), startedAt: agent.startedAt, endedAt: stop })
    }
  }
  const step = niceStep(span)
  const offset = -new Date(start).getTimezoneOffset() * MINUTE
  const ticks: TimelineTick[] = []
  for (let at = Math.ceil((start - offset) / step) * step + offset; at <= end; at += step) ticks.push({ at, left: ((at - start) / span) * 100 })
  return { start, end, ticks, lanes }
}
