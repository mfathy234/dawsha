import { changesLabel, isFolded, visibleRows, type TurnDiff, type TurnDiffRow } from '../../shared/turnDiff'
import { h } from '../dom'
import type { CardActions, DiffEntry } from './turnState'
import './turnExtras.css'

const SIGN: Readonly<Record<string, string>> = { add: '+', del: '−', ctx: ' ' }

function width(diff: TurnDiff): number {
  return Math.max(2, ...diff.rows.map((row) => String(Math.max(row.old ?? 0, row.new ?? 0)).length))
}

function line(row: TurnDiffRow, digits: number): HTMLElement {
  if (row.k === 'hunk') return h('div', { class: 'turn-hunk' }, row.t)
  const no = (value: number | undefined): HTMLElement => h('span', { class: 'no', 'aria-hidden': 'true' }, value === undefined ? '' : String(value).padStart(digits, ' '))
  const word = row.k === 'add' ? 'added' : row.k === 'del' ? 'removed' : ''
  return h('div', { class: `turn-ln ${row.k}` }, no(row.old), no(row.new), h('span', { class: 'sg', 'aria-hidden': 'true' }, SIGN[row.k] ?? ' '), h('span', { class: 'tx' }, row.t), word ? h('span', { class: 'sr-only' }, ` (${word})`) : null)
}

function footer(path: string, diff: TurnDiff, entry: Extract<DiffEntry, { status: 'ready' }>, actions: CardActions): HTMLElement {
  const folded = isFolded(diff, entry.open)
  const button = (label: string, run: () => void): HTMLElement => h('button', { class: 'link-quiet', type: 'button', onClick: run }, label)
  return h(
    'div',
    { class: 'turn-diff-foot' },
    h('span', {}, changesLabel(diff, entry.open), entry.changedSince ? ' · changed since this reply' : ''),
    h('span', { class: 'turn-diff-acts' },
      folded ? button('Show all', () => actions.showAll(path)) : null,
      folded ? button('Open in Review', actions.review) : null,
      button('Open in Files', () => actions.openFile(path)))
  )
}

/** The diff under one file row: hunk headers, both line numbers, coloured +/- lines. Text is always set as text. */
export function diffSection(path: string, entry: DiffEntry | undefined, actions: CardActions): HTMLElement {
  if (!entry || entry.status === 'loading') return h('div', { class: 'turn-diff', role: 'status' }, h('p', { class: 'turn-diff-note chat-quiet' }, 'Reading the change…'))
  if (entry.status === 'error') return h('div', { class: 'turn-diff', role: 'alert' }, h('p', { class: 'turn-diff-note chat-quiet' }, entry.error))
  const diff = entry.diff
  if (diff.rows.length === 0) {
    return h('div', { class: 'turn-diff' }, h('p', { class: 'turn-diff-note chat-quiet' }, entry.changedSince ? 'No difference from before this reply. Changed since this reply.' : 'No text changes to show.'), footer(path, diff, entry, actions))
  }
  const digits = width(diff)
  return h('div', { class: 'turn-diff', dir: 'ltr', role: 'group', 'aria-label': `Changes to ${path}` }, h('div', { class: 'turn-diff-body' }, ...visibleRows(diff, entry.open).map((row) => line(row, digits))), footer(path, diff, entry, actions))
}
