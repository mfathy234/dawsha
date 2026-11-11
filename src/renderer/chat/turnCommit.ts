import { commitButtonLabel, commitNote } from '../../shared/turnCommit'
import { h } from '../dom'
import type { CardView, CommitRow } from './turnState'
import './turnExtras.css'

function fileRow(row: CommitRow, view: CardView, busy: boolean): HTMLElement {
  const box = h('input', { type: 'checkbox', disabled: busy, 'aria-label': row.other ? `${row.path}, also has other changes` : row.path })
  box.checked = row.ticked
  box.addEventListener('change', () => view.actions.tick(row.path, box.checked))
  return h('label', { class: 'turn-commit-file', dir: 'ltr' }, box, h('span', { class: 'mono' }, row.path), row.other ? h('span', { class: 'chat-quiet' }, 'also has other changes') : null)
}

/** The inline commit box on a summary card. The message box is kept between redraws so typing is not lost. */
export function commitSection(view: CardView): HTMLElement | null {
  const commit = view.state.commit
  if (commit.phase === 'closed' || commit.phase === 'done') return null
  if (commit.phase === 'loading') return h('div', { class: 'turn-commit', role: 'status' }, h('p', { class: 'chat-quiet' }, 'Checking the files…'))
  const busy = commit.phase === 'busy'
  const count = commit.rows.filter((row) => row.ticked).length
  const message = view.box.value.trim()
  const submit = h('button', { class: 'btn small primary', type: 'button', disabled: busy || count === 0 || message === '', onClick: view.actions.submitCommit }, busy ? 'Committing…' : commitButtonLabel(count))
  const cancel = h('button', { class: 'btn small', type: 'button', disabled: busy, onClick: view.actions.cancelCommit }, 'Cancel')
  return h(
    'div',
    { class: 'turn-commit', role: 'group', 'aria-label': 'Commit this reply' },
    view.box,
    h('div', { class: 'turn-commit-files' }, ...commit.rows.map((row) => fileRow(row, view, busy))),
    commit.error ? h('p', { class: 'turn-commit-error', role: 'alert' }, commit.error) : null,
    h('div', { class: 'turn-commit-foot' }, h('span', { class: 'chat-quiet turn-commit-note' }, count === 0 ? 'Tick a file to commit.' : commitNote(count, commit.branch, commit.others + commit.rows.length - count)), cancel, submit)
  )
}
