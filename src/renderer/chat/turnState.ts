import type { CommitFile } from '../../shared/turnCommit'
import type { CheckResult } from '../../shared/turnChecks'
import type { TurnDiff } from '../../shared/turnDiff'

/** One file's diff on a summary card. */
export type DiffEntry =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; diff: TurnDiff; changedSince: boolean; open: boolean }

export interface CommitRow extends CommitFile {
  ticked: boolean
}

export type CommitState =
  | { phase: 'closed' }
  | { phase: 'loading' }
  | { phase: 'editing' | 'busy'; message: string; rows: readonly CommitRow[]; branch: string; others: number; error?: string }
  | { phase: 'done'; hash: string; branch: string }

export interface ChecksState {
  results: readonly CheckResult[]
  done: boolean
  /** The failures went to the agent from this card. */
  sent: boolean
}

/** Everything a summary card shows besides the files themselves. It is replaced, never changed. */
export interface CardState {
  expanded: ReadonlySet<string>
  diffs: ReadonlyMap<string, DiffEntry>
  commit: CommitState
  checks: ChecksState | null
}

export const emptyCard = (): CardState => ({ expanded: new Set(), diffs: new Map(), commit: { phase: 'closed' }, checks: null })

/** What the card's buttons do. TurnExtras supplies them. */
export interface CardActions {
  toggleFile(path: string): void
  showAll(path: string): void
  openFile(path: string): void
  review(): void
  startCommit(): void
  cancelCommit(): void
  tick(path: string, on: boolean): void
  submitCommit(): void
  push(): void
  openPullRequest(): void
  sendFailures(): void
  showOutput(): void
}

export interface CardView {
  state: CardState
  actions: CardActions
  agentName: string
  /** The folder is a git repository with a session that can commit. */
  canCommit: boolean
  /** Holds the commit message box between redraws, so typing and focus survive. */
  box: HTMLTextAreaElement
}
