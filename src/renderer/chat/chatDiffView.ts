import { DIFF_FOLD_LINES, type ChatDiff, type DiffLine } from '../../shared/chatDiff'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { h } from '../dom'

const SIGN: Readonly<Record<string, string>> = { add: '+', del: '-', ctx: ' ' }

function row(line: DiffLine, width: number): HTMLElement {
  if (line.k === 'gap') return h('div', { class: 'dl gap', 'aria-hidden': 'true' }, '⋯')
  return h(
    'div',
    { class: `dl ${line.k}` },
    h('span', { class: 'no', 'aria-hidden': 'true' }, line.n === undefined ? '' : String(line.n).padStart(width, ' ')),
    h('span', { class: 'sg', 'aria-hidden': 'true' }, SIGN[line.k] ?? ' '),
    h('span', { class: 'tx' }, line.t)
  )
}

export interface DiffViewOptions {
  /** Show every line, not just the first few. */
  open: boolean
  toggle: () => void
}

/** A change as coloured lines with their numbers; a long one folds. Line text is always set as text. */
export function renderDiff(diff: ChatDiff, options: DiffViewOptions): HTMLElement {
  const folds = diff.lines.length > DIFF_FOLD_LINES + 4
  const shown = folds && !options.open ? diff.lines.slice(0, DIFF_FOLD_LINES) : diff.lines
  const width = String(Math.max(0, ...diff.lines.map((line) => line.n ?? 0))).length
  const hidden = diff.lines.length - shown.length + diff.more
  const label = options.open ? CHAT_TEXT.showLess : CHAT_TEXT.showMore(hidden)
  return h(
    'div',
    { class: 'chat-diff', dir: 'ltr', role: 'group', 'aria-label': CHAT_TEXT.diffLabel },
    ...shown.map((line) => row(line, width)),
    folds ? h('button', { class: 'chat-more', type: 'button', onClick: options.toggle }, label) : null,
    diff.more > 0 && (options.open || !folds) ? h('p', { class: 'chat-quiet' }, CHAT_TEXT.diffMore(diff.more)) : null
  )
}
