import type { TurnSummary } from '../../shared/turnSummary'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { h } from '../dom'
import { fileLinkHost } from '../terminalExtras'

export function turnSummaryCard(summary: TurnSummary, scope: string, review: () => void, undo: (summary: TurnSummary) => void, worked?: string): HTMLElement {
  const host = fileLinkHost(scope)
  const rows = summary.files.map((file) => {
    const parts = file.path.split(/[\\/]/)
    const name = parts.pop() ?? file.path
    const folder = parts.length ? `${parts.join('/')}/` : ''
    const row = h('button', { class: 'chat-turn-file', type: 'button', title: file.path, dir: 'ltr' },
      h('span', { class: file.status === 'A' ? 'add' : file.status === 'D' ? 'warn' : 'chat-quiet' }, file.status),
      h('span', { class: 'chat-quiet' }, folder), h('b', {}, name),
      h('span', { class: 'add' }, `+${file.added}`), h('span', { class: 'del' }, `−${file.removed}`))
    row.addEventListener('click', () => host.open({ path: file.path }, { ctrlKey: true, metaKey: false, shiftKey: false }))
    return row
  })
  return h('section', { class: 'chat-turn-summary', 'aria-label': CHAT_TEXT.turnSummary },
    h('div', { class: 'chat-turn-head' }, h('b', {}, CHAT_TEXT.turnChanged(summary.files.length)), h('span', { class: 'add' }, `+${summary.added}`), h('span', { class: 'del' }, `−${summary.removed}`)),
    ...rows,
    h('div', { class: 'chat-turn-actions' },
      h('button', { class: 'link-quiet', type: 'button', onClick: review }, CHAT_TEXT.reviewChanges),
      summary.checkpointRef ? h('button', { class: 'link-quiet', type: 'button', onClick: () => undo(summary), 'aria-label': `${CHAT_TEXT.undoReply}: ${summary.files.length} files` }, CHAT_TEXT.undoReply) : null),
    worked ? h('span', { class: 'chat-quiet chat-worked', 'data-worked': '' }, worked) : null)
}
