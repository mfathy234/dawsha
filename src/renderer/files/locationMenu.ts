import { normalizeFolder } from '../../shared/folderKey'
import { checkoutFolderName, checkoutTitle, unavailableReason, type FilesCheckout } from '../../shared/filesWorkspace'
import type { LinkedRepo } from '../../shared/linkedRepos'
import type { ContextEntry } from '../components/contextMenu'

export interface LocationContext {
  projects: ReadonlyArray<{ id: string; name: string }>
  projectId: string
  projectName: string
  folder: string
  checkouts: readonly FilesCheckout[]
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

/** One menu for where Files is looking: projects, the project's checkouts, linked repos, then Copy path and Reveal. */
export function locationEntries(ctx: LocationContext): ContextEntry[] {
  const entries: ContextEntry[] = [{ heading: 'Projects' }]
  for (const project of ctx.projects) {
    entries.push({ label: project.name, current: project.id === ctx.projectId, run: () => (project.id === ctx.projectId ? undefined : ctx.switchProject(project.id)) })
  }
  entries.push({ heading: `Checkouts of ${ctx.projectName}` })
  for (const checkout of ctx.checkouts) {
    const here = normalizeFolder(checkout.folder) === normalizeFolder(ctx.folder)
    entries.push({
      label: checkoutTitle(checkout),
      detail: checkout.unavailable ? `${checkoutFolderName(checkout.folder)} · ${unavailableReason(checkout)}` : checkoutFolderName(checkout.folder),
      current: here,
      disabled: checkout.unavailable,
      run: () => (here ? undefined : ctx.switchCheckout(checkout.folder))
    })
  }
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
