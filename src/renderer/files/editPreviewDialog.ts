import type { EditPreviewFile } from '../../shared/codeNavExtras'
import { h } from '../dom'
import { nextDialogId, present } from '../components/dialogs'
import { dirtyConflicts, placesIn, previewRows } from './editPlan'

export interface EditPreviewSpec {
  title: string
  /** What the language service or search used, in words: "Exact (TypeScript)" or "Text search". */
  source: string
  files: readonly EditPreviewFile[]
  truncated: boolean
  /** Project paths of files with unsaved edits in an editor tab. */
  dirty: readonly string[]
  applyLabel: string
  /** The text of a project file before the edit, for the before and after lines. */
  text(path: string): Promise<string | null>
}

const TRUNCATED_NOTE = 'There are more matches than can be listed here, so nothing can be applied. Narrow the search and preview again.'

function fileBlock(file: EditPreviewFile, spec: EditPreviewSpec): HTMLElement {
  const body = h('div', { class: 'edit-preview-lines', hidden: true })
  let loaded = false
  const head = h('button', { class: 'edit-preview-file', type: 'button', 'aria-expanded': 'false', title: file.path }, h('span', { class: 'edit-preview-name' }, file.path), h('span', { class: 'edit-preview-count' }, `${file.matches} ${file.matches === 1 ? 'place' : 'places'}`))
  head.addEventListener('click', () => {
    const open = head.getAttribute('aria-expanded') !== 'true'
    head.setAttribute('aria-expanded', String(open))
    body.hidden = !open
    if (!open || loaded) return
    loaded = true
    body.replaceChildren(h('p', { class: 'edit-preview-note' }, 'Loading…'))
    void spec.text(file.path).then((text) => {
      if (text === null) return body.replaceChildren(h('p', { class: 'edit-preview-note' }, 'This file cannot be shown here.'))
      body.replaceChildren(...previewRows(text, file.edits).flatMap((row) => [
        h('div', { class: 'edit-preview-row before' }, h('u', {}, String(row.line)), h('span', {}, row.before)),
        h('div', { class: 'edit-preview-row after' }, h('u', {}, ''), h('span', {}, row.after))
      ]))
    })
  })
  return h('div', { class: 'edit-preview-block' }, head, body)
}

/** The list of what an edit would change, file by file, before anything is written. Resolves true when the user chose to go on to the confirmation. */
export function showEditPreview(spec: EditPreviewSpec): Promise<boolean> {
  const id = nextDialogId()
  const blocked = dirtyConflicts(spec.files, spec.dirty)
  const problem = spec.truncated ? TRUNCATED_NOTE : blocked.length > 0 ? `Save or close the unsaved edits in ${blocked.join(', ')} first, then preview again.` : ''
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const apply = h('button', { class: 'btn primary', type: 'button', id: 'edit-preview-apply', disabled: problem !== '' }, spec.applyLabel)
  const dialog = h('div', { class: 'dialog edit-preview', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}` },
    h('h2', { id: `dlg-title-${id}` }, spec.title),
    h('p', { class: 'edit-preview-summary' }, `${placesIn(spec.files)}. ${spec.source}.`),
    problem ? h('p', { class: 'edit-preview-problem', role: 'alert' }, problem) : null,
    h('div', { class: 'edit-preview-list' }, ...spec.files.map((file) => fileBlock(file, spec))),
    h('div', { class: 'dialog-actions' }, cancel, apply))
  const shown = present<boolean>(dialog, false, problem ? cancel : apply)
  cancel.addEventListener('click', () => shown.finish(false))
  apply.addEventListener('click', () => shown.finish(true))
  return shown.result
}
