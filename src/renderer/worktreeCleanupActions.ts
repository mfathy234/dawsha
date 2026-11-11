import { worktreeOfPane } from '../shared/mergeBack'
import { nudgeText, shouldOfferCleanup, uncommittedText, type CleanupCandidate, type CleanupResult } from '../shared/worktreeCleanup'
import { api } from './api'
import { confirmDialog } from './components/dialogs'
import { toast } from './components/toast'
import { worktreeCleanupDialog } from './components/worktreeCleanupDialog'
import { store } from './state'

const OFFERED_KEY = 'dawsha.worktreeCleanupOffered'
const NUDGE_DELAY_MS = 8000

/** The worktrees that panes are using right now; their sessions are open, so they are never offered. */
const openWorktreePaths = (): string[] => store.state.panes.flatMap((pane) => worktreeOfPane(pane)?.path ?? [])

const projectOf = (projectId: string) => store.state.settings.projects.find((project) => project.id === projectId)

function readOffered(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OFFERED_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function rememberOffered(projectId: string, count: number): void {
  try {
    localStorage.setItem(OFFERED_KEY, JSON.stringify({ ...readOffered(), [projectId]: count }))
  } catch {
    // Not remembering only means the notice may show once more.
  }
}

const sum = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

function summaryOf(result: Extract<CleanupResult, { ok: true }>): string {
  const base = `Removed ${sum(result.removed.length, 'worktree', 'worktrees')}`
  const branches = result.branchesDeleted.length > 0 ? ` and ${sum(result.branchesDeleted.length, 'branch', 'branches')}` : ''
  return `${base}${branches}.`
}

/** A second check before changes are thrown away: names the worktrees that will lose uncommitted files. */
async function confirmLoss(candidates: CleanupCandidate[], paths: Set<string>): Promise<boolean> {
  const lossy = candidates.filter((candidate) => paths.has(candidate.path) && candidate.dirtyFiles > 0)
  if (lossy.length === 0) return true
  const names = lossy.map((candidate) => `${candidate.branch} (${uncommittedText(candidate.dirtyFiles)})`).join(', ')
  return confirmDialog({
    title: 'Remove worktrees with uncommitted changes?',
    body: `These changes will be lost for good: ${names}.`,
    confirmLabel: lossy.length === 1 ? `Remove ${lossy[0].branch} and lose its changes` : `Remove ${lossy.length} worktrees and lose their changes`
  })
}

async function removeChosen(projectId: string, folder: string, name: string): Promise<void> {
  const listed = await api.worktreeCleanupList(folder, openWorktreePaths())
  if (!listed.ok) return toast(listed.error)
  if (listed.candidates.length === 0) return toast(`No worktrees are left over from closed sessions in ${name}.`, 'info')
  const choice = await worktreeCleanupDialog(name, listed.candidates)
  if (!choice) return
  const paths = new Set(choice.plan.items.map((item) => item.path))
  if (!(await confirmLoss(choice.candidates, paths))) return
  const result = await api.worktreeCleanupRun({ repo: folder, openPaths: openWorktreePaths(), items: choice.plan.items })
  if (!result.ok) return toast(result.error)
  rememberOffered(projectId, 0)
  const failed = result.failed.map((entry) => entry.error)
  toast(failed.length > 0 ? `${summaryOf(result)} ${failed.length} could not be removed: ${failed[0]}` : summaryOf(result), failed.length > 0 ? 'error' : 'info')
}

/** Project menu and command palette: lists the leftover worktrees of a project and removes the ticked ones. */
export async function openWorktreeCleanup(projectId: string): Promise<void> {
  const project = projectOf(projectId)
  if (!project) return
  try {
    await removeChosen(projectId, project.folder, project.name)
  } catch (error) {
    toast((error as Error).message || 'Could not clean up worktrees.')
  }
}

async function offerFor(projectId: string): Promise<boolean> {
  const project = projectOf(projectId)
  if (!project) return false
  const count = await api.worktreeCleanupCount(project.folder, openWorktreePaths())
  if (!shouldOfferCleanup(count, readOffered()[projectId] ?? 0)) return false
  rememberOffered(projectId, count)
  toast(nudgeText(project.name, count), 'info', { label: 'Clean up', run: () => void openWorktreeCleanup(projectId) })
  return true
}

/** A while after start: one notice for the first project with more than three leftover worktrees. */
export function installWorktreeNudge(): void {
  setTimeout(() => {
    void (async () => {
      for (const project of store.state.settings.projects) {
        try {
          if (await offerFor(project.id)) return
        } catch {
          // A project that cannot be read has nothing to offer.
        }
      }
    })()
  }, NUDGE_DELAY_MS)
}
