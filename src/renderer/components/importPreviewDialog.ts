import { previewLines, type ImportSummary, type ParsedTransfer, type TransferMode } from '../../shared/settingsTransfer'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'

function modeOption(name: string, value: TransferMode, title: string, note: string, checked: boolean): HTMLElement {
  const input = h('input', { type: 'radio', name, value, id: `import-mode-${value}` })
  input.checked = checked
  return h('label', { class: 'import-mode', for: `import-mode-${value}` }, input, h('span', {}, h('strong', {}, title), h('span', { class: 'hint' }, note)))
}

function sourceLine(transfer: ParsedTransfer): string {
  const version = transfer.appVersion ? `Dawsha ${transfer.appVersion}` : 'Dawsha'
  const date = transfer.exportedAt ? new Date(transfer.exportedAt) : null
  const when = date && !Number.isNaN(date.getTime()) ? ` on ${date.toLocaleDateString()}` : ''
  const skipped = transfer.skipped > 0 ? ` ${transfer.skipped} unreadable entries were skipped.` : ''
  return `Exported from ${version}${when}.${skipped}`
}

export function chooseImportMode(summary: ImportSummary, transfer: ParsedTransfer): Promise<TransferMode | null> {
  const id = nextDialogId()
  const titleId = `dlg-title-${id}`
  const group = `import-mode-group-${id}`
  const lines = previewLines(summary)
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const confirm = h('button', { class: 'btn primary', type: 'button', id: 'import-confirm', 'data-confirm': '' }, 'Import')
  const merge = modeOption(group, 'merge', 'Merge', 'Add what is new and keep what is already here. Imported preferences are applied.', true)
  const replace = modeOption(group, 'replace', 'Replace', 'Replace your projects, snippets and layouts with the ones in the file.', false)
  const dialog = h(
    'div',
    { class: 'dialog import-preview', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('h2', { id: titleId }, 'Import settings'),
    h('p', { class: 'dialog-hint' }, sourceLine(transfer)),
    lines.length > 0 ? h('ul', { class: 'import-lines' }, ...lines.map((line) => h('li', {}, line))) : h('p', {}, 'The file has nothing to import.'),
    h('div', { class: 'import-modes', role: 'radiogroup', 'aria-label': 'How to import' }, merge, replace),
    h('div', { class: 'dialog-actions' }, cancel, confirm)
  )
  const shown = present<TransferMode | null>(dialog, null, confirm)
  cancel.addEventListener('click', () => shown.finish(null))
  confirm.addEventListener('click', () => {
    const picked = dialog.querySelector<HTMLInputElement>(`input[name="${group}"]:checked`)
    shown.finish(picked?.value === 'replace' ? 'replace' : 'merge')
  })
  return shown.result
}
