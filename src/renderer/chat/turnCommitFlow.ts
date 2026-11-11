import type { TurnSummary } from '../../shared/turnSummary'
import { editedSince } from '../../shared/turnDiff'
import type { TurnFileInfo } from '../../shared/turnApi'
import { suggestCommitMessage } from '../../shared/turnCommit'
import { api } from '../api'
import { confirmDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import type { CardState, CommitRow } from './turnState'

/** What the commit flow needs from the card it works for. */
export interface CommitPort {
  summary: TurnSummary
  folder: string
  branch: string
  repliedAt: number | undefined
  request: string
  reply: string
  box: HTMLTextAreaElement
  state(): CardState
  patch(change: Partial<CardState>): void
}

const slash = (path: string): string => path.replace(/\\/g, '/')

/** Opens the commit box: the files this reply changed that still differ from HEAD, the ones edited since left unticked. */
export async function openCommitBox(port: CommitPort): Promise<void> {
  port.patch({ commit: { phase: 'loading' } })
  const [status, info] = await Promise.all([
    api.gitStatus(port.folder).catch(() => null),
    api.turn.inspect(port.folder, port.summary.files.map((file) => file.path)).catch((): Record<string, TurnFileInfo> => ({}))
  ])
  if (!status || !status.ok) {
    port.patch({ commit: { phase: 'closed' } })
    return void toast(status && !status.ok ? status.error : 'Could not read the changes in this folder.', 'error')
  }
  const changed = new Set(status.status.files.map((file) => slash(file.path)))
  const rows: CommitRow[] = port.summary.files.flatMap((file): CommitRow[] => {
    const found = info[file.path]
    if (!found || !changed.has(found.rel)) return []
    const other = editedSince(found.mtimeMs, port.repliedAt)
    return [{ path: found.rel, other, ticked: !other }]
  })
  if (rows.length === 0) {
    port.patch({ commit: { phase: 'closed' } })
    return void toast('These files have no changes left to commit.', 'info')
  }
  port.box.value = suggestCommitMessage({ request: port.request, reply: port.reply })
  port.patch({ commit: { phase: 'editing', message: port.box.value, rows, branch: status.status.branch ?? port.branch, others: Math.max(0, status.status.files.length - rows.length) } })
}

/** Stages and commits only the ticked paths; other staged or unstaged changes are left alone. */
export async function submitCommit(port: CommitPort): Promise<void> {
  const commit = port.state().commit
  if (commit.phase !== 'editing') return
  const paths = commit.rows.filter((row) => row.ticked).map((row) => row.path)
  const message = port.box.value.trim()
  if (paths.length === 0 || message === '') return
  port.patch({ commit: { ...commit, phase: 'busy', error: undefined } })
  const result = await api.gitCommit({ folder: port.folder, paths, message, push: false }).catch((error: Error) => ({ ok: false as const, error: error.message }))
  if (result.ok) return port.patch({ commit: { phase: 'done', hash: result.hash, branch: commit.branch } })
  port.patch({ commit: { ...commit, phase: 'editing', error: result.error } })
}

/** Pushes after a confirm that names the branch. */
export async function pushCommitted(folder: string, branch: string): Promise<void> {
  const ok = await confirmDialog({ title: 'Push commit', body: `Push the new commit on ${branch || 'this branch'} to its remote?`, confirmLabel: `Push ${branch || 'branch'}`, danger: false })
  if (!ok) return
  const result = await api.gitPush(folder).catch((error: Error) => ({ ok: false as const, error: error.message }))
  toast(result.ok ? `Pushed ${branch || 'the branch'}.` : result.error, result.ok ? 'info' : 'error')
}
