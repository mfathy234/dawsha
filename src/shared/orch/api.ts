import type { OrchRunner } from './profiles'
import type { DecisionKind, OrchEvent, OrchRole, OrchTask, RunKind, RunStage } from './types'
import type { RunUsage } from './usage'

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
  taskKey: string | null
  agentRole: OrchRole | null
  agentModel: string | null
}

export interface OrchRunView {
  id: string
  kind: RunKind
  title: string
  stage: RunStage
  projectId: string | null
  createdAt: number
  taskCount: number
  tasksDone: number
  openDecisions: number
}

export interface OrchStatus {
  enabled: boolean
  running: boolean
  error: string | null
}

/** What an agent is doing right now, as shown in the Agents list and on task cards. */
export type OrchAgentState = 'working' | 'waiting' | 'stalled' | 'idle' | 'done'

export interface OrchAgentRow {
  id: string
  role: OrchRole
  runner: string
  model: string
  state: OrchAgentState
  taskKey: string | null
  retired: boolean
}

/** One run with everything the Orchestrator screens show for it. */
export interface OrchRunDetail extends OrchRunView {
  imported?: { at: number; from: string }
  decisions?: import('./types').OrchDecision[]
  story: string
  plan: string
  projectPath: string
  finishedAt: number | null
  branch: string
  tasks: OrchTask[]
  agents: OrchAgentRow[]
  usage: RunUsage
  /** Newest last; at most the last 200. */
  events: OrchEvent[]
}

/** The whole orchestrator state the renderer needs; pushed again after every change. */
export interface OrchSnapshot {
  status: OrchStatus
  runs: OrchRunDetail[]
  decisions: OrchDecisionView[]
}

export interface OrchHandoffInput {
  runId: string
  taskKey: string
  profileId: string
  note: string
}
