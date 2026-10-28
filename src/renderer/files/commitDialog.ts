import { selectCommitFiles } from '../../shared/review'
import { api } from '../api'
import { h } from '../dom'
import { nextDialogId, present } from '../components/dialogs'

export interface CommitFile {
  path: string
  letter: string
  added: number | null
  removed: number | null
}

export interface CommitDialogOptions {
  folder: string
  files: CommitFile[]
  draft: string
}

/** The commit dialog: an editable message and a tick per changed file. Git hooks run as usual, and a refusal is shown as git said it. Resolves to the short hash, or null when closed. */
export function commitDialog(options: CommitDialogOptions): Promise<string | null> {
  const id = nextDialogId()
  const unchecked = new Set<string>()
  const message = h('textarea', { class: 'commit-message', id: 'commit-message', rows: '4', 'aria-label': 'Commit message', placeholder: 'Commit message' })
  message.value = options.draft
  const errorText = h('pre', { class: 'commit-error-text' })
  const error = h('div', { class: 'commit-error', id: 'commit-error', role: 'alert', hidden: true }, h('strong', {}, 'Not committed.'), errorText)
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const confirm = h('button', { class: 'btn primary', type: 'button', id: 'commit-confirm' })
  const rows = options.files.map((file) => {
    const tick = h('input', { type: 'checkbox', 'data-path': file.path, 'aria-label': `Include ${file.path}` })
    tick.checked = true
    tick.addEventListener('change', () => {
      if (tick.checked) unchecked.delete(file.path)
      else unchecked.add(file.path)
      sync()
    })
    const stat = file.added !== null || file.removed !== null ? ` +${file.added ?? 0} −${file.removed ?? 0}` : ''
    return h('label', { class: 'commit-file' }, tick, h('span', { class: 'commit-file-path' }, file.path), h('span', { class: 'commit-file-meta' }, `${file.letter === 'U' ? 'A' : file.letter}${stat}`))
  })
  const chosen = (): string[] => selectCommitFiles(options.files.map((file) => file.path), unchecked)
  const sync = (): void => {
    const count = chosen().length
    confirm.textContent = count === 1 ? 'Commit 1 file' : `Commit ${count} files`
    confirm.disabled = count === 0
  }
  const dialog = h('div', { class: 'dialog commit-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}` },
    h('h2', { id: `dlg-title-${id}` }, 'Commit changes'),
    h('label', { class: 'commit-label', for: 'commit-message' }, 'Message'),
    message,
    h('div', { class: 'commit-label' }, 'Files to include'),
    h('div', { class: 'commit-files', role: 'group', 'aria-label': 'Files to include' }, ...rows),
    error,
    h('div', { class: 'dialog-actions' }, cancel, confirm))
  const shown = present<string | null>(dialog, null, message)
  cancel.addEventListener('click', () => shown.finish(null))
  confirm.addEventListener('click', async () => {
    const paths = chosen()
    if (paths.length === 0) return
    confirm.disabled = true
    cancel.disabled = true
    error.hidden = true
    confirm.textContent = 'Committing…'
    const result = await api.gitCommit({ folder: options.folder, paths, message: message.value, push: false }).catch((failure: Error) => ({ ok: false as const, error: failure.message }))
    cancel.disabled = false
    if (result.ok) {
      shown.finish(result.hash)
      return
    }
    error.hidden = false
    errorText.textContent = result.error
    sync()
  })
  sync()
  return shown.result
}
