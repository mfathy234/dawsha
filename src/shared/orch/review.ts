import type { OrchDecisionView, OrchRunDetail } from './api'
import type { DecisionKind, OrchRole } from './types'

// Pure helpers behind the All runs and Human review screens.

export const DECISION_KIND_LABEL: Record<DecisionKind, string> = {
  question: 'Question',
  'spec-approval': 'Spec approval',
  escalation: 'Escalation',
  stall: 'Stalled',
  'merge-conflict': 'Merge conflict',
  'run-complete': 'Run finished'
}

export const OTHER_OPTION = 'Other'
export const LIVE_TIMELINE_LIMIT = 12
export const QUICK_OPTION_LIMIT = 4
const TAG_MAX = 14

export const decisionKindLabel = (kind: DecisionKind): string => DECISION_KIND_LABEL[kind] ?? kind

/** Oldest first: the one waiting longest comes first. Does not change the input. */
export function sortDecisions(decisions: readonly OrchDecisionView[]): OrchDecisionView[] {
  return [...decisions].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

/** The longest-waiting open decision of each run. */
export function oldestDecisionByRun(decisions: readonly OrchDecisionView[]): Map<string, OrchDecisionView> {
  const byRun = new Map<string, OrchDecisionView>()
  for (const decision of sortDecisions(decisions)) {
    if (!byRun.has(decision.runId)) byRun.set(decision.runId, decision)
  }
  return byRun
}

export interface RunFilterChip {
  runId: string
  title: string
  count: number
}

/** One chip per run that has open decisions, in the order its oldest decision arrived. */
export function runFilterChips(decisions: readonly OrchDecisionView[]): RunFilterChip[] {
  const chips = new Map<string, RunFilterChip>()
  for (const decision of sortDecisions(decisions)) {
    const chip = chips.get(decision.runId)
    if (chip) chips.set(decision.runId, { ...chip, count: chip.count + 1 })
    else chips.set(decision.runId, { runId: decision.runId, title: decision.runTitle, count: 1 })
  }
  return [...chips.values()]
}

/** Sorted decisions, limited to one run when a filter is set. */
export function filterDecisions(decisions: readonly OrchDecisionView[], runId: string | null): OrchDecisionView[] {
  const sorted = sortDecisions(decisions)
  return runId ? sorted.filter((d) => d.runId === runId) : sorted
}

/**
 * Keeps the current selection while it is still listed. When it vanished, picks the entry that follows it in the
 * previous list (or the last one); with no earlier selection picks the first.
 */
export function pickSelection(ids: readonly string[], current: string | null, previousIds: readonly string[] = []): string | null {
  if (ids.length === 0) return null
  if (current && ids.includes(current)) return current
  const was = current ? previousIds.indexOf(current) : -1
  if (was < 0) return ids[0]
  const following = previousIds.slice(was + 1).find((id) => ids.includes(id))
  return following ?? ids[ids.length - 1]
}

/** What to send for a decision: the option, the note, or "<option>. <note>" when both are given. */
export function composeAnswer(option: string | null, note: string): string {
  const text = note.trim()
  const chosen = option && option !== OTHER_OPTION ? option : ''
  if (chosen && text) return `${chosen}. ${text}`
  return chosen || text
}

export interface LiveEvent {
  runId: string
  runTitle: string
  at: number
  kind: string
  text: string
}

/** The newest events across all runs, newest first. */
export function liveTimeline(runs: readonly Pick<OrchRunDetail, 'id' | 'title' | 'events'>[], limit = LIVE_TIMELINE_LIMIT): LiveEvent[] {
  return runs
    .flatMap((run) => run.events.map((e) => ({ runId: run.id, runTitle: run.title, at: e.at, kind: e.kind, text: e.text })))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}

/** Words that say how to work, not what the run is about ("on a branch based on develop in ..."). */
const FILLER = new Set(['on', 'a', 'an', 'the', 'in', 'into', 'to', 'for', 'of', 'and', 'or', 'at', 'by', 'with', 'from', 'i', 'we', 'need', 'needs', 'want',
  'please', 'branch', 'based', 'new', 'worktree', 'develop', 'main', 'master', 'is', 'be', 'it'])

/** A short label for a run in tight places: its first meaningful words, at most 14 characters. */
export function runTag(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  const meaningful = words.filter((w) => !FILLER.has(w.toLowerCase().replace(/[^a-z]/g, '')))
  const first = (meaningful.length > 0 ? meaningful : words).slice(0, 2).join(' ')
  const tag = first.length > TAG_MAX ? first.split(' ')[0] : first
  if (!tag) return 'run'
  return tag.length > TAG_MAX ? `${tag.slice(0, TAG_MAX - 1)}…` : tag
}

export interface RunCounts {
  running: number
  waiting: number
  agents: number
}

export const isActiveRun = (run: Pick<OrchRunDetail, 'stage'>): boolean => run.stage !== 'done' && run.stage !== 'cancelled'

/** Header counts: active runs, open decisions, agents working now. */
export function runCounts(runs: readonly OrchRunDetail[], decisions: readonly OrchDecisionView[]): RunCounts {
  const active = runs.filter(isActiveRun)
  return {
    running: active.length,
    waiting: decisions.length,
    agents: active.reduce((sum, run) => sum + run.agents.filter((a) => !a.retired && a.state === 'working').length, 0)
  }
}

export interface Activity {
  text: string
  tone: 'working' | 'waiting' | 'stalled' | 'idle'
}

/** Who is working, waiting or stalled in a run, most urgent first. */
export function activitySummary(run: Pick<OrchRunDetail, 'agents'>, roleLabel: (role: OrchRole) => string): Activity {
  const live = run.agents.filter((a) => !a.retired)
  const describe = (a: (typeof live)[number], verb: string): string => `${roleLabel(a.role)}${a.taskKey ? ` ${a.taskKey}` : ''} ${verb}`
  const stalled = live.filter((a) => a.state === 'stalled')
  if (stalled.length > 0) return { text: stalled.map((a) => describe(a, 'is stalled')).join(' · '), tone: 'stalled' }
  const waiting = live.filter((a) => a.state === 'waiting')
  if (waiting.length > 0) return { text: waiting.map((a) => describe(a, 'is waiting for you')).join(' · '), tone: 'waiting' }
  const working = live.filter((a) => a.state === 'working')
  if (working.length > 0) return { text: working.map((a) => describe(a, 'is working')).join(' · '), tone: 'working' }
  return { text: 'No agent is running right now', tone: 'idle' }
}
