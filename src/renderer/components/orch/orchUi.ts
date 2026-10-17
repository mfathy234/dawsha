import type { OrchAgentState, OrchRunDetail } from '../../../shared/orch/api'
import type { OrchRole, OrchTask, RunStage, TaskStatus } from '../../../shared/orch/types'
import { h } from '../../dom'

// Small shared pieces for the Orchestrator screens: labels, board columns, badges.

export const ROLE_LABEL: Record<OrchRole, string> = {
  lead: 'Lead',
  'spec-writer': 'Spec writer',
  implementer: 'Implementer',
  ui: 'UI',
  'code-reviewer': 'Code reviewer',
  'ux-reviewer': 'UX reviewer',
  tester: 'Tester',
  fixer: 'Fixer'
}

/** Stages shown in a run's progress line. The lead plans first; Spec appears only when it asked for one. */
export const FEATURE_STAGES: { id: RunStage; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'spec', label: 'Spec' },
  { id: 'build', label: 'Build' },
  { id: 'merge', label: 'Merge' },
  { id: 'done', label: 'Done' }
]
/** Bug runs skip Spec and Plan. */
export const BUG_STAGES = FEATURE_STAGES.filter((s) => s.id !== 'spec' && s.id !== 'plan')
const NO_SPEC_STAGES = FEATURE_STAGES.filter((s) => s.id !== 'spec')

const hasSpec = (run: Pick<OrchRunDetail, 'tasks'>): boolean => (run.tasks ?? []).some((t) => t.role === 'spec-writer')

export const stagesOf = (run: Pick<OrchRunDetail, 'kind' | 'tasks'>): { id: RunStage; label: string }[] =>
  run.kind === 'bug' ? BUG_STAGES : hasSpec(run) ? FEATURE_STAGES : NO_SPEC_STAGES

/**
 * Index of the current step. After an approved spec the lead plans again before building; that counts as Build,
 * since the track never steps backwards.
 */
export function currentStageIndex(run: Pick<OrchRunDetail, 'kind' | 'tasks' | 'stage'>): number {
  const stages = stagesOf(run)
  const specDone = (run.tasks ?? []).some((t) => t.role === 'spec-writer' && t.status === 'approved')
  const stage = run.stage === 'review' || (run.stage === 'plan' && specDone) ? 'build' : run.stage
  return stages.findIndex((s) => s.id === stage)
}

export type BoardColumn = 'todo' | 'progress' | 'review' | 'needs' | 'done'

export const BOARD_COLUMNS: { id: BoardColumn; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'needs', label: 'Needs you' },
  { id: 'done', label: 'Done' }
]

const COLUMN_OF: Record<TaskStatus, BoardColumn> = {
  todo: 'todo',
  assigned: 'progress',
  in_progress: 'progress',
  done_pending_review: 'review',
  in_review: 'review',
  waiting_on_human: 'needs',
  blocked: 'needs',
  stalled: 'needs',
  approved: 'done',
  cancelled: 'done'
}

export const columnOf = (task: Pick<OrchTask, 'status'>): BoardColumn => COLUMN_OF[task.status]

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'to do',
  assigned: 'starting',
  in_progress: 'in progress',
  done_pending_review: 'waiting for review',
  in_review: 'in review',
  approved: 'done',
  blocked: 'blocked',
  waiting_on_human: 'needs you',
  stalled: 'stalled',
  cancelled: 'cancelled'
}

export const AGENT_STATE_LABEL: Record<OrchAgentState, string> = {
  working: 'working',
  waiting: 'needs you',
  stalled: 'stalled',
  idle: 'idle',
  done: 'finished'
}

/** Vendor of a runner name like "claude", "codex-local": decides the badge colour. */
export function vendorOf(runner: string): 'claude' | 'codex' | 'gemini' | 'local' {
  if (runner.endsWith('-local')) return 'local'
  if (runner.startsWith('codex')) return 'codex'
  if (runner.startsWith('gemini')) return 'gemini'
  return 'claude'
}

/** "Implementer · gpt-5.5-codex" badge coloured by vendor. */
export function modelBadge(runner: string, model: string, prefix?: string): HTMLElement {
  const name = model && model !== 'default' ? model : runner.replace(/-local$/, '')
  return h('span', { class: `orch-model v-${vendorOf(runner)}`, title: `${runner} · ${model}` }, prefix ? `${prefix} · ${name}` : name)
}

/** A small status pill: tone is one of working, waiting, stalled, idle, done. */
export function pill(label: string, tone: string): HTMLElement {
  return h('span', { class: `orch-pill tone-${tone}` }, label)
}

export function timeAgo(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function elapsed(from: number, to = Date.now()): string {
  const minutes = Math.max(0, Math.round((to - from) / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
