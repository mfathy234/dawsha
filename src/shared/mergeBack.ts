import { isCompareBranch, isCompareWorktree } from './compare'
import { parseNumstatZ } from './gitStatus'
import type { CompareLink, PaneWorktree } from './types'

export interface MergeFileRow {
  path: string
  added: number | null
  removed: number | null
}

/** What the Merge back dialog shows, read fresh from git each time it opens. */
export interface MergeOverview {
  branch: string
  /** The branch the main folder has checked out, which a merge lands on; null while it is detached. */
  baseBranch: string | null
  ahead: number
  files: MergeFileRow[]
  worktreeDirtyFiles: number
  baseDirtyFiles: number
  lastSubject: string
}

export interface MergeBackRequest {
  repo: string
  path: string
}

export type MergeOverviewResult = ({ ok: true } & MergeOverview) | { ok: false; error: string }

export type SessionWorktreeResult = { ok: true; path: string; branch: string } | { ok: false; error: string }

export type MergeResult = { ok: true; message: string } | { ok: false; error: string; conflicts?: string[] }

export interface WorktreeRemoveRequest extends MergeBackRequest {
  /** Delete even though the branch has commits that are not merged or the folder has uncommitted files. */
  force: boolean
}

export interface WorktreeCommitRequest extends MergeBackRequest {
  message: string
}

const SHORT = '[a-z0-9]{4,12}'
const PRESET_BRANCH = new RegExp(`^preset/${SHORT}$`)
const PRESET_WORKTREE = new RegExp(`-preset-${SHORT}$`)

export const isPresetBranch = (value: string): boolean => PRESET_BRANCH.test(value)
export const isPresetWorktree = (value: string): boolean => PRESET_WORKTREE.test(value)
export const isOwnBranch = (value: string): boolean => isPresetBranch(value) || isCompareBranch(value)
export const isOwnWorktree = (value: string): boolean => isPresetWorktree(value) || isCompareWorktree(value)

export function presetWorktreeNames(folder: string, short: string): { path: string; branch: string } {
  const trimmed = folder.replace(/[\\/]+$/, '')
  return { path: `${trimmed}-preset-${short}`, branch: `preset/${short}` }
}

type WorktreeSource = { worktree?: PaneWorktree; compare?: CompareLink }

/** The worktree Dawsha made for a pane: its own marker, else the side of a Compare pair it works in. */
export function worktreeOfPane(pane: WorktreeSource): PaneWorktree | null {
  if (pane.worktree) return pane.worktree
  const { compare } = pane
  const side = compare?.sides?.[compare.slot]
  return compare && side ? { repo: compare.repo, path: side.path, branch: side.branch } : null
}

export const numstatRows = (text: string): MergeFileRow[] => parseNumstatZ(text)

export const parseConflictFiles = (text: string): string[] => [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))]

const files = (count: number): string => `${count} uncommitted file${count === 1 ? '' : 's'}`

export interface RefusalInput {
  baseBranch: string | null
  baseDirtyFiles: number
  worktreeDirtyFiles: number
  ahead: number
}

export function mergeRefusal(input: RefusalInput): string | null {
  if (input.baseBranch === null) return 'The main folder has no branch checked out, so there is nothing to merge into. Check out a branch there first.'
  if (input.baseDirtyFiles > 0) {
    return `The main folder has ${files(input.baseDirtyFiles)}. Commit or stash them there first, so the merge cannot mix with your own work.`
  }
  if (input.worktreeDirtyFiles > 0) return `The worktree has ${files(input.worktreeDirtyFiles)} that a merge would leave behind. Commit them first.`
  return input.ahead === 0 ? 'There is nothing to merge: this branch has no commits of its own.' : null
}

const CONFLICTS_SHOWN = 8

export function conflictText(base: string, conflicts: readonly string[]): string {
  const shown = conflicts.slice(0, CONFLICTS_SHOWN).join(', ')
  const more = conflicts.length > CONFLICTS_SHOWN ? ` and ${conflicts.length - CONFLICTS_SHOWN} more` : ''
  return `Merging into ${base} conflicts in ${shown}${more}. The merge was aborted and nothing changed.`
}

export const defaultCommitMessage = (branch: string): string => `Work from preset ${branch.replace(/^preset\//, '')}`

export const commitMessageProblem = (message: string): string | null => (message.trim() === '' ? 'Enter a commit message.' : null)

export const removeBlock = (running: boolean): string | null =>
  running ? 'Its session is still running. Close the session first, then remove the worktree.' : null

export const worktreeName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

export interface RemoveCopy {
  title: string
  body: string
  confirmLabel: string
  force: boolean
}

/** The confirmation for removing a worktree: it names the folder and says what is lost when the work is not merged. */
export function removeCopy(path: string, branch: string, work: { ahead: number; dirtyFiles: number }): RemoveCopy {
  const lost: string[] = []
  if (work.dirtyFiles > 0) lost.push(`${work.dirtyFiles} uncommitted file${work.dirtyFiles === 1 ? '' : 's'}`)
  if (work.ahead > 0) lost.push(`${work.ahead} commit${work.ahead === 1 ? '' : 's'} that ${work.ahead === 1 ? 'is' : 'are'} not merged`)
  const loss = lost.length > 0 ? ` It still has ${lost.join(' and ')}, which will be lost.` : ''
  return {
    title: `Remove the worktree ${path}?`,
    body: `This deletes the folder ${path} and the branch ${branch}.${loss}`,
    confirmLabel: `Remove ${worktreeName(path)}`,
    force: lost.length > 0
  }
}
