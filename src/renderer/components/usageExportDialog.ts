import {
  EXPORT_COLUMNS_NOTE,
  EXPORT_GROUPINGS,
  EXPORT_RANGES,
  isExportGrouping,
  isExportRange,
  type ExportGrouping,
  type ExportRange
} from '../../shared/usageCsv'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'
import { selectMenu } from './selectMenu'

export interface ExportChoice {
  range: ExportRange
  grouping: ExportGrouping
}

function select(id: string, options: readonly { value: string; label: string }[], value: string): HTMLSelectElement {
  const control = h('select', { class: 'rp-project field-select', id })
  for (const option of options) control.append(h('option', { value: option.value }, option.label))
  control.value = value
  return control
}

const field = (label: string, id: string, control: HTMLElement): HTMLElement =>
  h('div', { class: 'field' }, h('label', { for: id, class: 'dialog-label' }, label), control)

/** Asks which days to export and how to group the rows. Resolves null on Cancel. */
export function usageExportDialog(initial: ExportChoice = { range: 'month', grouping: 'dayProjectAgent' }): Promise<ExportChoice | null> {
  const id = nextDialogId()
  const range = select(`exp-range-${id}`, EXPORT_RANGES, initial.range)
  const grouping = select(`exp-group-${id}`, EXPORT_GROUPINGS, initial.grouping)
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const save = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, 'Save CSV…')
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}` },
    h('h2', { id: `dlg-title-${id}` }, 'Export usage'),
    field('Range', range.id, selectMenu(range)),
    field('One row per', grouping.id, selectMenu(grouping)),
    h('p', { class: 'dialog-hint' }, EXPORT_COLUMNS_NOTE),
    h('div', { class: 'dialog-actions' }, cancel, save)
  )
  const shown = present<ExportChoice | null>(dialog, null, save)
  cancel.addEventListener('click', () => shown.finish(null))
  save.addEventListener('click', () => {
    if (isExportRange(range.value) && isExportGrouping(grouping.value)) shown.finish({ range: range.value, grouping: grouping.value })
  })
  return shown.result
}
