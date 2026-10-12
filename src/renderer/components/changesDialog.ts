import {
  SUBJECT_HINT_LENGTH,
  discardMessage,
  firstLine,
  isStaged,
  isUnstaged,
  statusLetter,
  type GitFileEntry,
  type RepoStatus
} from '../../shared/gitStatus'
import { api } from '../api'
import { h } from '../dom'
import { confirmDialog, nextDialogId, present } from './dialogs'
import { toast } from './toast'
import { primaryModifierPressed } from '../../shared/shortcuts'

export interface ChangesOptions {
  folder: string
  title: string
  onChanged(): void
}

function countCell(file: GitFileEntry): HTMLElement {
  if (file.added === null && file.removed === null) return h('span', { class: 'changes-counts muted' }, file.untracked ? 'new' : 'binary')
  return h(
    'span',
    { class: 'changes-counts' },
    h('span', { class: 'add' }, `+${file.added ?? 0}`),
    ' ',
    h('span', { class: 'del' }, `−${file.removed ?? 0}`)
  )
}

function stateWord(file: GitFileEntry): string {
  if (file.conflicted) return 'conflict'
  if (file.untracked) return 'untracked'
  if (isStaged(file) && isUnstaged(file)) return 'staged + unstaged'
  return isStaged(file) ? 'staged' : 'unstaged'
}

export function openChangesDialog(options: ChangesOptions): Promise<void> {
  const id = nextDialogId()
  let status: RepoStatus | null = null
  let busy = false
  const unchecked = new Set<string>()
  const diffs = new Map<string, string>()
  const open = new Set<string>()

  const branchLine = h('p', { class: 'dialog-hint changes-branch' })
  const list = h('div', { class: 'changes-list', role: 'list', 'aria-label': 'Changed files' })
  const selectAll = h('input', { type: 'checkbox', id: `chg-all-${id}`, 'aria-label': 'Select all files' }) as HTMLInputElement
  const selectedText = h('span', { class: 'muted' })
  const area = h('textarea', {
    class: 'text-input changes-message',
    id: `chg-msg-${id}`,
    rows: '3',
    spellcheck: 'false',
    placeholder: 'Commit message',
    'aria-label': 'Commit message'
  }) as HTMLTextAreaElement
  const hint = h('span', { class: 'changes-subject muted' })
  const error = h('pre', { class: 'field-error changes-error', role: 'alert', hidden: true })
  const discard = h('button', { class: 'btn danger', type: 'button', 'data-discard': '' }, 'Discard…') as HTMLButtonElement
  const close = h('button', { class: 'btn ghost', type: 'button' }, 'Close') as HTMLButtonElement
  const commit = h('button', { class: 'btn primary', type: 'button', 'data-commit': '' }, 'Commit') as HTMLButtonElement
  const commitPush = h('button', { class: 'btn primary', type: 'button', 'data-commit-push': '', hidden: true }, 'Commit and push') as HTMLButtonElement
  const dialog = h(
    'div',
    { class: 'dialog changes-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Changes in ${options.title}` },
    h('h2', {}, 'Changes'),
    branchLine,
    h('div', { class: 'changes-select' }, h('label', { class: 'changes-check', for: `chg-all-${id}` }, selectAll, ' All files'), selectedText),
    list,
    area,
    h('div', { class: 'changes-foot' }, hint),
    error,
    h('div', { class: 'dialog-actions changes-actions' }, discard, h('span', { class: 'spacer' }), close, commit, commitPush)
  )
  const shown = present<void>(dialog, undefined, area)

  const files = (): GitFileEntry[] => status?.files ?? []
  const selected = (): GitFileEntry[] => files().filter((file) => !unchecked.has(file.path))
  const showError = (text: string | null): void => {
    error.hidden = text === null
    error.textContent = text ?? ''
  }

  const syncControls = (): void => {
    const picked = selected().length
    const total = files().length
    selectAll.checked = total > 0 && picked === total
    selectAll.indeterminate = picked > 0 && picked < total
    selectAll.disabled = busy || total === 0
    selectedText.textContent = total === 0 ? '' : `${picked} of ${total} selected`
    const noneChecked = picked === 0
    discard.disabled = busy || noneChecked
    commit.disabled = busy || noneChecked
    commitPush.disabled = busy || noneChecked
    close.disabled = busy
    const subject = firstLine(area.value)
    hint.textContent = `${subject.length} / ${SUBJECT_HINT_LENGTH}`
    hint.classList.toggle('over', subject.length > SUBJECT_HINT_LENGTH)
    hint.title = 'First line of the message; 72 characters or fewer reads best in git log'
  }

  const renderBranch = (): void => {
    if (!status) return
    const parts = [status.branch ?? 'detached HEAD']
    if (status.upstream) parts.push(`${status.upstream} · ${status.ahead} ahead, ${status.behind} behind`)
    else parts.push('no upstream')
    branchLine.textContent = parts.join(' · ')
    commitPush.hidden = !status.upstream
  }

  const toggleDiff = async (file: GitFileEntry): Promise<void> => {
    if (open.has(file.path)) open.delete(file.path)
    else {
      open.add(file.path)
      if (!diffs.has(file.path)) {
        const result = await api.gitDiff(options.folder, file.path)
        diffs.set(file.path, result.ok ? result.text || 'No textual changes.' : result.error)
      }
    }
    renderList()
  }

  const row = (file: GitFileEntry): HTMLElement => {
    const box = h('input', { type: 'checkbox', 'aria-label': file.path, 'data-path': file.path }) as HTMLInputElement
    box.checked = !unchecked.has(file.path)
    box.disabled = busy
    box.addEventListener('change', () => {
      if (box.checked) unchecked.delete(file.path)
      else unchecked.add(file.path)
      syncControls()
    })
    const showing = open.has(file.path)
    const diffButton = h(
      'button',
      { class: 'btn ghost changes-diff-toggle', type: 'button', 'aria-expanded': showing ? 'true' : 'false', 'aria-label': `${showing ? 'Hide' : 'Show'} diff of ${file.path}` },
      showing ? 'Hide diff' : 'Show diff'
    )
    diffButton.addEventListener('click', () => void toggleDiff(file))
    const label = file.origPath ? `${file.origPath} → ${file.path}` : file.path
    const line = h(
      'div',
      { class: 'changes-row', role: 'listitem', 'data-path': file.path },
      box,
      h('span', { class: `changes-letter letter-${statusLetter(file)}`, title: stateWord(file) }, statusLetter(file)),
      h('span', { class: 'changes-path', title: label }, label),
      countCell(file),
      diffButton
    )
    if (!showing) return line
    return h('div', { class: 'changes-item' }, line, h('pre', { class: 'changes-diff', 'data-diff': file.path }, diffs.get(file.path) ?? ''))
  }

  function renderList(): void {
    if (!status) return
    if (files().length === 0) list.replaceChildren(h('p', { class: 'changes-empty muted' }, 'Working tree clean. Nothing to commit.'))
    else list.replaceChildren(...files().map(row))
    syncControls()
  }

  const refresh = async (): Promise<void> => {
    const result = await api.gitStatus(options.folder).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!result.ok) {
      showError(result.error)
      return
    }
    status = result.status
    const current = new Set(status.files.map((file) => file.path))
    for (const path of [...unchecked]) if (!current.has(path)) unchecked.delete(path)
    for (const path of [...open]) if (!current.has(path)) open.delete(path)
    diffs.clear()
    for (const path of open) {
      const diff = await api.gitDiff(options.folder, path)
      diffs.set(path, diff.ok ? diff.text || 'No textual changes.' : diff.error)
    }
    renderBranch()
    renderList()
  }

  const setBusy = (value: boolean): void => {
    busy = value
    renderList()
  }

  const runCommit = async (push: boolean): Promise<void> => {
    showError(null)
    if (area.value.trim() === '') {
      showError('Enter a commit message.')
      area.focus()
      return
    }
    setBusy(true)
    try {
      const paths = selected().map((file) => file.path)
      const result = await api.gitCommit({ folder: options.folder, paths, message: area.value, push })
      if (result.ok) {
        area.value = ''
        toast(`Committed ${result.hash}${result.pushed ? ' and pushed' : ''}`, 'info')
      } else {
        showError(result.error)
        if (result.committed) area.value = ''
      }
      await refresh()
    } catch (error) {
      showError(`Commit failed: ${(error as Error).message}`)
    } finally {
      setBusy(false)
      options.onChanged()
    }
  }

  const runDiscard = async (): Promise<void> => {
    showError(null)
    const picked = selected()
    const paths = picked.map((file) => file.path)
    const message = discardMessage(paths, picked.filter((file) => file.untracked).map((file) => file.path))
    const confirmed = await confirmDialog({ title: message.title, body: message.body, confirmLabel: message.label })
    if (!confirmed) return
    setBusy(true)
    try {
      const result = await api.gitDiscard({ folder: options.folder, paths })
      if (result.ok) toast(paths.length === 1 ? `Discarded ${paths[0]}` : `Discarded ${paths.length} files`, 'info')
      else showError(result.error)
      await refresh()
    } catch (error) {
      showError(`Discard failed: ${(error as Error).message}`)
    } finally {
      setBusy(false)
      options.onChanged()
    }
  }

  selectAll.addEventListener('change', () => {
    if (selectAll.checked) unchecked.clear()
    else for (const file of files()) unchecked.add(file.path)
    renderList()
  })
  area.addEventListener('input', () => {
    showError(null)
    syncControls()
  })
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && primaryModifierPressed(event) && !busy && selected().length > 0) {
      event.preventDefault()
      void runCommit(false)
    }
  })
  close.addEventListener('click', () => shown.finish())
  commit.addEventListener('click', () => void runCommit(false))
  commitPush.addEventListener('click', () => void runCommit(true))
  discard.addEventListener('click', () => void runDiscard())
  syncControls()
  void refresh()
  return shown.result
}
