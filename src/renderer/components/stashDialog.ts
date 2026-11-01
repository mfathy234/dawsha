import './stashDialog.css'
import { stashDialogText, type DirtyReport } from '../../shared/gitBranches'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'

export interface StashChoice {
  /** The "also stash the new files" box was ticked. */
  includeNew: boolean
}

/** The stash guard: what would be stashed, an off-by-default box for new files, and a confirm button that names the exact items. Resolves null on Cancel. */
export function stashDialog(branch: string, report: DirtyReport): Promise<StashChoice | null> {
  const id = nextDialogId()
  const text = (includeNew: boolean) => stashDialogText(branch, report, includeNew)
  const first = text(false)
  const box = h('input', { type: 'checkbox', id: `dlg-new-${id}`, class: 'stash-new-box' })
  const boxLabel = h('label', { class: 'stash-new-label', for: `dlg-new-${id}` }, first.checkbox?.label ?? '')
  const left = h('p', { class: 'stash-left', role: 'status' })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const confirm = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' })
  const rows = h('dl', { class: 'stash-rows' }, ...first.rows.flatMap((row) => [h('dt', {}, row.label), h('dd', {}, row.value)]))
  const dialog = h(
    'div',
    { class: 'dialog stash-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}`, 'aria-describedby': `dlg-body-${id}` },
    h('h2', { id: `dlg-title-${id}` }, first.title),
    h('p', { id: `dlg-body-${id}` }, first.body),
    rows,
    first.checkbox ? h('div', { class: 'stash-new' }, box, boxLabel, h('p', { class: 'stash-hint' }, first.checkbox.hint)) : null,
    left,
    h('div', { class: 'dialog-actions' }, cancel, confirm)
  )
  const sync = (): void => {
    const now = text(box.checked)
    confirm.textContent = now.confirmLabel
    left.textContent = now.leftBehind ?? ''
    left.hidden = now.leftBehind === null
  }
  const shown = present<StashChoice | null>(dialog, null, cancel)
  box.addEventListener('change', sync)
  cancel.addEventListener('click', () => shown.finish(null))
  confirm.addEventListener('click', () => shown.finish({ includeNew: box.checked }))
  sync()
  return shown.result
}
