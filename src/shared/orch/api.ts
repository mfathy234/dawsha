import type { OrchRunner } from './profiles'
import type { DecisionKind, RunKind, RunStage } from './types'

// What the renderer and the main process exchange about the orchestrator.

/** Main asks the renderer to open a pane for an agent. The token never travels this way. */
export interface OrchPaneRequest {
  agentId: string
  runId: string
  projectId: string | null
  folder: string
  runner: OrchRunner
  title: string
  prompt: string
  sessionId: string | null
}

export interface OrchStartInput {
  kind: RunKind
  projectId: string
  title: string
  story: string
  planId: string
  /** Bug runs: the profile for the single fixer; null uses the plan's main (lead) model. */
  fixerProfileId: string | null
}

export type OrchResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string }

/** An open question for the human, with enough context to answer it. */
export interface OrchDecisionView {
  id: string
  kind: DecisionKind
  runId: string
  runTitle: string
  question: string
  options: string[]
  context: string
  createdAt: number
}

export interface OrchRunView {
  id: string
  kind: RunKind
  title: string
  stage: RunStage
  projectId: string | null
  createdAt: number
  tasks: number
  tasksDone: number
  openDecisions: number
}

export interface OrchStatus {
  enabled: boolean
  running: boolean
  error: string | null
}
