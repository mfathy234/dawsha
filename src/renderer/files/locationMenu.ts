import { normalizeFolder } from '../../shared/folderKey'
import { ONLY_MAIN_CHECKOUT, checkoutFolderName, checkoutTitle, unavailableReason, type FilesCheckout } from '../../shared/filesWorkspace'
import type { LinkedRepo } from '../../shared/linkedRepos'
import type { ContextEntry } from '../components/contextMenu'

export interface LocationContext {
  projects: ReadonlyArray<{ id: string; name: string }>
  projectId: string
  projectName: string
  folder: string
  checkouts: readonly FilesCheckout[]
  /** The folder is a git repository, so it can have worktrees. */
  git?: boolean
  /** The worktree list is still being read, could not be read, or is up to date. */
  worktrees?: 'loading' | 'failed' | 'ready'
  /** Worktrees first, for the branch control and Ctrl+Alt+W. */
  worktreesFirst?: boolean
  retryWorktrees?(): void
  linked: readonly LinkedRepo[]
  switchProject(id: string): void
  switchCheckout(folder: string): void
  openLinked(repo: LinkedRepo): void
  copyPath(): void
  reveal(): void
}

export interface SendContext {
  sessions: ReadonlyArray<{ paneId: string; title: string }>
  sendTo(paneId: string): void
  newSession(): void
  copyMention(): void
}

function projectEntries(ctx: LocationContext): ContextEntry[] {
  const entries: ContextEntry[] = [{ heading: 'Projects' }]
  for (const project of ctx.projects) {
    entries.push({ label: project.name, current: project.id === ctx.projectId, run: () => (project.id === ctx.projectId ? undefined : ctx.switchProject(project.id)) })
  }
  return entries
}

function worktreeEntries(ctx: LocationContext): ContextEntry[] {
  const entries: ContextEntry[] = [{ heading: 'Worktrees' }]
  if (ctx.git === false) {
    entries.push({ label: 'Not a Git repository.', detail: 'This folder has no branches or worktrees.', disabled: true, run: () => undefined })
    return entries
  }
  for (const checkout of ctx.checkouts) {
    const here = normalizeFolder(checkout.folder) === normalizeFolder(ctx.folder)
    const folderName = checkoutFolderName(checkout.folder)
    entries.push({
      label: checkoutTitle(checkout),
      detail: checkout.unavailable ? `${folderName} · ${unavailableReason(checkout)}` : here ? `Current · ${folderName}` : folderName,
      current: here,
      disabled: checkout.unavailable,
      run: () => (here ? undefined : ctx.switchCheckout(checkout.folder))
    })
  }
  if (ctx.worktrees === 'loading') entries.push({ label: 'Loading worktrees…', disabled: true, run: () => undefined })
  else if (ctx.worktrees === 'failed') entries.push({ label: "Couldn't list worktrees. Retry", run: () => ctx.retryWorktrees?.() })
  else if (ctx.checkouts.length <= 1) entries.push({ ...ONLY_MAIN_CHECKOUT, disabled: true, run: () => undefined })
  return entries
}

/** One menu for where Files is looking: projects and the project's worktrees (either first), linked repos, then Copy path and Reveal. */
export function locationEntries(ctx: LocationContext): ContextEntry[] {
  const entries: ContextEntry[] = ctx.worktreesFirst ? [...worktreeEntries(ctx), 'separator', ...projectEntries(ctx)] : [...projectEntries(ctx), ...worktreeEntries(ctx)]
  if (ctx.linked.length > 0) {
    entries.push({ heading: 'Linked repos' })
    for (const repo of ctx.linked) {
      entries.push({
        label: repo.name,
        detail: repo.projectId === null ? 'Not a project in Dawsha, so it cannot be opened here' : repo.folder,
        disabled: repo.projectId === null,
        run: () => ctx.openLinked(repo)
      })
    }
  }
  entries.push('separator', { label: 'Copy path', run: ctx.copyPath }, { label: 'Reveal in File Explorer', run: ctx.reveal })
  return entries
}

/** Send to agent: the live sessions of this project by their full names, then a new session and the @mention. */
export function sendEntries(ctx: SendContext): ContextEntry[] {
  const entries: ContextEntry[] = ctx.sessions.length === 0
    ? [{ label: 'No live session in this project', disabled: true, run: () => undefined }]
    : ctx.sessions.map((session) => ({ label: session.title, run: () => ctx.sendTo(session.paneId) }))
  entries.push('separator', { label: 'New session with this file…', run: ctx.newSession }, { label: 'Copy as @mention', run: ctx.copyMention })
  return entries
}
