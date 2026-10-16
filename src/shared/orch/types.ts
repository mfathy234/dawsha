import type { OrchLaunch } from './launch'

export const ORCH_ROLES = ['lead', 'spec-writer', 'implementer', 'ui', 'code-reviewer', 'ux-reviewer', 'tester', 'fixer'] as const
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
  /** Times an agent was started on it and lost (pane closed, CLI exited). */
  attempts?: number
  /** When its branch was merged into the run branch. */
  mergedAt?: number | null
}

/** A feature gets the whole team; a bug is fixed by one agent with no subagents. */
export type RunKind = 'feature' | 'bug'

export type RunStage = 'spec' | 'plan' | 'build' | 'review' | 'merge' | 'done' | 'cancelled'

export interface OrchRun {
  id: string
  kind: RunKind
  projectPath: string
  title: string
  story: string
  plan: string
  stage: RunStage
  createdAt: number
  finishedAt: number | null
  /** Dawsha project the run belongs to. */
  projectId?: string | null
  /** Stop for the human to approve the spec (from the plan). Defaults to true. */
  specApproval?: boolean
  /** Bug runs: the profile the user picked for the fixer. */
  fixerProfileId?: string | null
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
  /** Latest cumulative usage reported by Dawsha's runner for this agent's CLI session. */
  usage: AgentUsage | null
  /** Set when the agent is replaced or its run ends; its token stops working. */
  retiredAt?: number | null
  /** How Dawsha starts its pane (no token inside); kept so a restored pane can start again. */
  launch?: OrchLaunch | null
  /** Last time the agent called any orch tool; null until it first connects. */
  lastCallAt?: number | null
}

export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Cost the CLI itself reported (Claude Code does); null when only tokens are known. */
  reportedCostUsd: number | null
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

export type DecisionKind = 'question' | 'spec-approval' | 'escalation' | 'stall' | 'merge-conflict' | 'run-complete'

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

/** Everything another agent needs to continue a task: exported on demand or when handing it over. */
export interface OrchTaskState {
  exportedAt: number
  run: Pick<OrchRun, 'id' | 'title' | 'story' | 'projectPath' | 'plan'>
  task: OrchTask
  agent: Pick<OrchAgent, 'id' | 'role' | 'runner' | 'model'> | null
  progress: string[]
  messages: { from: string; body: string; at: number }[]
  notes: { key: string; text: string; author: string }[]
  /** Markdown brief written for the agent that takes over. */
  brief: string
}

export interface OrchEvent {
  runId: string
  at: number
  kind: string
  text: string
  taskId: string | null
}
