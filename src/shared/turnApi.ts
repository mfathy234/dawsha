import type { CheckRunUpdate } from './turnChecks'

export const TURN_IPC = {
  fileDiff: 'turn:file-diff',
  inspect: 'turn:inspect',
  runChecks: 'turn:run-checks',
  stopChecks: 'turn:stop-checks',
  checksUpdate: 'turn:checks-update'
} as const

export interface TurnFileDiffRequest {
  folder: string
  sessionId: string
  ref: string
  path: string
}

export type TurnFileDiffResult =
  | { ok: true; text: string; mtimeMs: number | null; gone: boolean }
  | { ok: false; error: string }

export interface TurnFileInfo {
  /** Relative to the repository root, with forward slashes. */
  rel: string
  mtimeMs: number | null
}

export interface RunChecksRequest {
  folder: string
  projectId: string
  sessionId: string
  commandIds: string[]
}

export type RunChecksResult = { ok: true; runId: string } | { ok: false; error: string }

/** Diffs against a reply's checkpoint and the checks that run after a reply. */
export interface TurnApi {
  fileDiff(request: TurnFileDiffRequest): Promise<TurnFileDiffResult>
  /** Each path as a repository path, with when it was last saved (null when the file is gone). Paths outside the repository are left out. */
  inspect(folder: string, paths: string[]): Promise<Record<string, TurnFileInfo>>
  runChecks(request: RunChecksRequest): Promise<RunChecksResult>
  stopChecks(sessionId: string): Promise<void>
  onChecksUpdate(listener: (update: CheckRunUpdate) => void): () => void
}
