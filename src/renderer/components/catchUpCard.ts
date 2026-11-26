import type { CatchUpRow } from '../../shared/away'
import { focusPane, showView } from '../actions'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'
import './catchUp.css'

/** "While you were away": one line per session that needs you, finished or failed. */
export async function openCatchUp(headline: string, rows: readonly CatchUpRow[]): Promise<void> {
  if (document.querySelector('.catchup-dialog')) return
  const id = nextDialogId()
  const dismiss = h('button', { class: 'btn ghost', type: 'button' }, 'Dismiss')
  const inbox = h('button', { class: 'btn primary', type: 'button' }, 'Open inbox')
  const list = h('div', { class: 'catchup-rows', role: 'list' }, ...rows.map((row) => h('div', { class: 'catchup-row', role: 'listitem', 'data-kind': row.kind, 'data-pane-id': row.paneId },
    h('span', { class: `catchup-state kind-${row.kind}` }, row.label),
    h('button', { class: 'catchup-what', type: 'button', onClick: () => { shown.finish('open'); showView('grid'); focusPane(row.paneId) } }, h('span', { class: 'catchup-name', dir: 'auto' }, row.name), ' ', h('span', { class: 'catchup-line', dir: 'auto' }, row.what)))))
  const dialog = h('div', { class: 'dialog catchup-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}` },
    h('h2', { id: `dlg-title-${id}` }, 'While you were away'),
    h('p', { class: 'catchup-headline' }, headline),
    list,
    h('div', { class: 'dialog-actions' }, dismiss, inbox))
  const shown = present<'dismiss' | 'inbox' | 'open'>(dialog, 'dismiss', inbox)
  dismiss.addEventListener('click', () => shown.finish('dismiss'))
  inbox.addEventListener('click', () => shown.finish('inbox'))
  if ((await shown.result) === 'inbox') showView('inbox')
}
