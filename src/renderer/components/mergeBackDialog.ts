import { commitMessageProblem, defaultCommitMessage, mergeRefusal, removeBlock, type MergeFileRow, type MergeOverview } from '../../shared/mergeBack'
import type { PaneWorktree } from '../../shared/types'
import { api } from '../api'
import { h } from '../dom'
import { present } from './dialogs'
import './mergeBack.css'

export interface MergeBackHost {
  worktree: PaneWorktree
  /** True while a session still runs in the worktree. */
  sessionRunning(): boolean
  /** Confirms and removes the worktree; resolves true when it is gone. */
  removeWorktree(overview: MergeOverview): Promise<boolean>
}

function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? { dir: '', name: path } : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}

function counts(file: MergeFileRow): HTMLElement {
  if (file.added === null && file.removed === null) return h('span', { class: 'changes-counts muted' }, 'binary')
  return h('span', { class: 'changes-counts' }, h('span', { class: 'add' }, `+${file.added ?? 0}`), ' ', h('span', { class: 'del' }, `−${file.removed ?? 0}`))
}

function fileRow(file: MergeFileRow): HTMLElement {
  const { dir, name } = splitPath(file.path)
  return h('div', { class: 'changes-row', role: 'listitem' }, h('span', { class: 'changes-name' }, h('span', { class: 'changes-file' }, name), dir ? h('span', { class: 'changes-dir' }, dir) : null), counts(file))
}

function totals(files: MergeFileRow[]): string {
  const added = files.reduce((sum, file) => sum + (file.added ?? 0), 0)
  const removed = files.reduce((sum, file) => sum + (file.removed ?? 0), 0)
  return `${files.length} ${files.length === 1 ? 'file' : 'files'}, +${added} −${removed}`
}

/** The Merge back dialog: what the worktree changed against the branch it came from, and what to do with it. */
export function mergeBackDialog(host: MergeBackHost): Promise<void> {
  let overview: MergeOverview | null = null
  let busy = false
  const summary = h('p', { class: 'dialog-hint merge-summary' }, 'Reading the worktree...')
  const list = h('div', { class: 'merge-files', role: 'list', 'aria-label': 'Changed files' })
  const commitBox = h('div', { class: 'merge-commit', hidden: true })
  const message = h('p', { class: 'compare-error', role: 'alert', hidden: true })
  const notice = h('p', { class: 'dialog-hint merge-note', role: 'status' })
  const close = h('button', { class: 'btn ghost', type: 'button' }, 'Close')
  const remove = h('button', { class: 'btn ghost', type: 'button', id: 'merge-remove' }, 'Remove worktree')
  const pr = h('button', { class: 'btn', type: 'button', id: 'merge-pr' }, 'Open pull request')
  const merge = h('button', { class: 'btn primary', type: 'button', id: 'merge-into', 'data-confirm': '' }, 'Merge')
  const dialog = h(
    'div',
    { class: 'dialog merge-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Merge back' },
    h('h2', {}, 'Merge back'),
    summary,
    list,
    commitBox,
    message,
    notice,
    h('div', { class: 'dialog-actions' }, remove, h('span', { class: 'spacer' }), close, pr, merge)
  )
  const shown = present<void>(dialog, undefined, close)

  const show = (text: string | null): void => {
    message.textContent = text ?? ''
    message.hidden = text === null
  }
  const controls = [remove, pr, merge]
  const lock = (value: boolean): void => {
    busy = value
    for (const control of controls) control.disabled = value || overview === null
    if (!value) paint()
  }

  function paintCommit(info: MergeOverview): void {
    commitBox.hidden = info.worktreeDirtyFiles === 0
    if (info.worktreeDirtyFiles === 0) return
    const input = h('input', { class: 'text-input', type: 'text', id: 'merge-commit-message', value: defaultCommitMessage(info.branch), 'aria-label': 'Commit message', autocomplete: 'off', spellcheck: 'false' })
    const commit = h('button', { class: 'btn', type: 'button', id: 'merge-commit' }, 'Commit them first')
    commit.addEventListener('click', () => void runCommit(input.value))
    commitBox.replaceChildren(
      h('p', { class: 'dialog-hint' }, `The worktree has ${info.worktreeDirtyFiles} uncommitted ${info.worktreeDirtyFiles === 1 ? 'file' : 'files'}. A merge leaves them behind.`),
      h('div', { class: 'merge-commit-row' }, input, commit)
    )
  }

  function paint(): void {
    if (!overview) return
    const info = overview
    const into = info.baseBranch ?? 'the main folder'
    summary.textContent = `${info.branch} into ${into}: ${info.ahead} ${info.ahead === 1 ? 'commit' : 'commits'}, ${totals(info.files)}`
    list.replaceChildren(...(info.files.length > 0 ? info.files.map(fileRow) : [h('p', { class: 'changes-empty' }, 'No committed changes against the main branch yet.')]))
    paintCommit(info)
    merge.textContent = info.baseBranch ? `Merge into ${info.baseBranch}` : 'Merge'
    const refusal = mergeRefusal(info)
    merge.disabled = busy || refusal !== null
    pr.disabled = busy || info.ahead === 0 || info.baseBranch === null
    notice.textContent = refusal ?? ''
    remove.disabled = busy
    remove.title = removeBlock(host.sessionRunning()) ?? ''
  }

  async function reload(): Promise<boolean> {
    const result = await api.mergeOverview(host.worktree)
    if (!result.ok) {
      overview = null
      show(result.error)
      return false
    }
    overview = result
    paint()
    return true
  }

  async function runCommit(text: string): Promise<void> {
    const problem = commitMessageProblem(text)
    if (problem) return show(problem)
    lock(true)
    show(null)
    const result = await api.mergeCommit({ ...host.worktree, message: text })
    if (!result.ok) show(result.error)
    await reload()
    lock(false)
  }

  async function runMerge(): Promise<void> {
    lock(true)
    show(null)
    const result = await api.mergeInto(host.worktree)
    if (!result.ok) show(result.error)
    await reload()
    lock(false)
    if (result.ok) notice.textContent = result.message
  }

  async function runPr(): Promise<void> {
    if (!overview?.baseBranch) return
    lock(true)
    show(null)
    const title = overview.lastSubject || overview.branch
    const result = await api.tools.pullRequest({ folder: host.worktree.path, action: 'create', title, body: '', base: overview.baseBranch, draft: false })
    lock(false)
    if (!result.ok) return show(result.error)
    notice.textContent = result.url ? `${result.message} ${result.url}` : result.message
  }

  async function runRemove(): Promise<void> {
    const blocked = removeBlock(host.sessionRunning())
    if (blocked) return show(blocked)
    if (!overview) return
    lock(true)
    show(null)
    const removed = await host.removeWorktree(overview)
    lock(false)
    if (removed) shown.finish(undefined)
  }

  close.addEventListener('click', () => shown.finish(undefined))
  merge.addEventListener('click', () => void runMerge())
  pr.addEventListener('click', () => void runPr())
  remove.addEventListener('click', () => void runRemove())
  for (const control of controls) control.disabled = true
  void reload().then(() => lock(false))
  return shown.result
}
