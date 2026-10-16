export const ORCH_ROLES = ['lead', 'spec-writer', 'implementer', 'ui', 'code-reviewer', 'ux-reviewer', 'tester'] as const
export type OrchRole = (typeof ORCH_ROLES)[number]

export const TASK_STATUSES = [
  'todo',
  'assigned',
  'in_progress',
  'done_pending_review',
  'in_review',
  'approved',
  'blocked',
  'waiting_on_human',
  'stalled',
  'cancelled'
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export type PauseStatus = 'blocked' | 'waiting_on_human'

export interface OrchTask {
  /** Unique across runs: `${runId}:${key}`. */
  id: string
  /** Short name agents and people use inside a run, e.g. `T-3`. */
  key: string
  runId: string
  title: string
  spec: string
  role: OrchRole
  status: TaskStatus
  /** Keys of tasks in the same run that must be approved first. */
  dependsOn: string[]
  acceptance: string[]
  /** Key of the task this one reviews, for review tasks. */
  reviewOf: string | null
  reviewRound: number
  /** Agent id working on it. */
  assignee: string | null
  summary: string | null
  files: string[]
  branch: string | null
  /** Latest reviewer comments or human feedback for the assignee. */
  feedback: string | null
  pausedFrom: TaskStatus | null
  createdAt: number
  updatedAt: number
}

export type RunStage = 'spec' | 'plan' | 'build' | 'review' | 'merge' | 'done' | 'cancelled'

export interface OrchRun {
  id: string
  projectPath: string
  title: string
  story: string
  plan: string
  stage: RunStage
  createdAt: number
  finishedAt: number | null
}

export interface OrchAgent {
  id: string
  runId: string
  role: OrchRole
  runner: string
  model: string
  token: string
  taskId: string | null
  createdAt: number
}

export interface OrchMessage {
  id: string
  runId: string
  /** Agent id, or `human` / `dawsha`. */
  from: string
  to: string
  taskId: string | null
  body: string
  createdAt: number
  readAt: number | null
}

export interface OrchNote {
  runId: string
  key: string
  text: string
  author: string
  updatedAt: number
}

export type DecisionKind = 'question' | 'spec-approval' | 'escalation'

export interface OrchDecision {
  id: string
  runId: string
  kind: DecisionKind
  taskId: string | null
  agentId: string | null
  question: string
  options: string[]
  recommended: number | null
  context: string
  urgency: 'normal' | 'high'
  answer: string | null
  createdAt: number
  answeredAt: number | null
}

export interface OrchEvent {
  runId: string
  at: number
  kind: string
  text: string
  taskId: string | null
}
