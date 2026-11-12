import {
  branchOptionLabel,
  candidateDetail,
  cleanupPlan,
  cleanupTitle,
  initialTicks,
  removeLabel,
  toggled,
  uncommittedText,
  type CleanupCandidate,
  type CleanupPlan
} from '../../shared/worktreeCleanup'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'
import './worktreeCleanup.css'

export interface CleanupChoice {
  plan: CleanupPlan
  candidates: CleanupCandidate[]
}

interface RowParts {
  row: HTMLElement
  box: HTMLInputElement
  note: HTMLElement
}

function buildRow(candidate: CleanupCandidate, ticked: boolean, now: number): RowParts {
  const box = h('input', { type: 'checkbox', class: 'wtc-box', checked: ticked, 'data-path': candidate.path }) as HTMLInputElement
  const note = h('span', { class: 'wtc-warn' })
  const row = h(
    'label',
    { class: 'wtc-row', title: candidate.path },
    box,
    h('span', { class: 'wtc-name' }, candidate.branch),
    note,
    h('span', { class: 'wtc-detail' }, candidateDetail(candidate, now))
  )
  return { row, box, note }
}

/** The dirty row says it plainly: its changes are lost when it is ticked. */
function warnText(candidate: CleanupCandidate, ticked: boolean): string {
  if (candidate.dirtyFiles === 0) return ''
  return ticked ? `${uncommittedText(candidate.dirtyFiles)}, will be lost` : uncommittedText(candidate.dirtyFiles)
}

/**
 * Lists the leftover worktrees with a tick each. Resolves with what is ticked when the danger button is pressed, or null on Cancel.
 * The button and the title count the ticks, and the branch box names the merged branches it would delete.
 */
export function worktreeCleanupDialog(project: string, candidates: CleanupCandidate[], now = Date.now()): Promise<CleanupChoice | null> {
  const id = nextDialogId()
  let ticks = initialTicks(candidates)
  const title = h('h2', { id: `dlg-title-${id}` })
  const parts = candidates.map((candidate) => ({ candidate, ...buildRow(candidate, ticks.has(candidate.path), now) }))
  const branchBox = h('input', { type: 'checkbox', id: `wtc-branches-${id}` }) as HTMLInputElement
  const branchLabel = h('label', { class: 'wtc-opt', for: branchBox.id }, branchBox, h('span', {}))
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const confirm = h('button', { class: 'btn danger', type: 'button', 'data-confirm': '' })
  const dialog = h(
    'div',
    { class: 'dialog wtc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}`, 'aria-describedby': `dlg-body-${id}` },
    title,
    h('p', { id: `dlg-body-${id}` }, 'Their folders are deleted. Branches stay unless you tick the box. Worktrees with uncommitted changes are not ticked.'),
    h('div', { class: 'wtc-list' }, ...parts.map((part) => part.row)),
    branchLabel,
    h('div', { class: 'dialog-actions' }, cancel, confirm)
  )
  const shown = present<CleanupChoice | null>(dialog, null, cancel)
  const current = (): CleanupPlan => cleanupPlan(candidates, ticks, branchBox.checked)
  const sync = (): void => {
    const plan = current()
    const count = plan.items.length
    title.textContent = cleanupTitle(project, count)
    confirm.textContent = removeLabel(count)
    confirm.disabled = count === 0
    branchBox.disabled = plan.mergedBranches.length === 0
    if (branchBox.disabled) branchBox.checked = false
    branchLabel.lastElementChild!.textContent = branchOptionLabel(plan.mergedBranches)
    for (const part of parts) part.note.textContent = warnText(part.candidate, ticks.has(part.candidate.path))
  }
  for (const part of parts) {
    part.box.addEventListener('change', () => {
      ticks = toggled(ticks, part.candidate.path, part.box.checked)
      sync()
    })
  }
  branchBox.addEventListener('change', sync)
  cancel.addEventListener('click', () => shown.finish(null))
  confirm.addEventListener('click', () => shown.finish({ plan: current(), candidates }))
  sync()
  return shown.result
}
