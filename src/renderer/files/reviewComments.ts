import { h, icon } from '../dom'
import { ICONS } from '../icons'

export interface CommentRow {
  id: string
  path: string
  line: number
  endLine?: number
  text: string
  sent: boolean
  outdated: boolean
  reviewer: boolean
}

export interface CommentsHooks {
  jump(id: string): void
  edit(id: string): void
  remove(id: string): void
}

const split = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const refOf = (row: CommentRow): string => `${split(row.path)}:${row.endLine ? `${row.line}-${row.endLine}` : row.line}`

/** The "Comments (4)" bar: every comment on this checkout's diff, with jump to, edit and delete. Sent ones stay below as history. */
export class CommentsBar {
  readonly el = h('section', { class: 'files-comments', id: 'files-comments', 'aria-label': 'Review comments', hidden: true })
  private readonly head = h('button', { class: 'files-comments-head', type: 'button', id: 'files-comments-head', 'aria-expanded': 'true', 'aria-controls': 'files-comments-list', onClick: () => this.setOpen(!this.open) })
  private readonly list = h('div', { class: 'files-comments-list', id: 'files-comments-list', role: 'list' })
  private open = true

  constructor(private readonly hooks: CommentsHooks) {
    this.el.append(this.head, this.list)
  }

  private setOpen(open: boolean): void {
    this.open = open
    this.head.setAttribute('aria-expanded', String(open))
    this.list.hidden = !open
  }

  render(rows: readonly CommentRow[]): void {
    this.el.hidden = rows.length === 0
    const waiting = rows.filter((row) => !row.sent)
    const sent = rows.length - waiting.length
    this.head.replaceChildren(icon(this.open ? ICONS.chevronDown : ICONS.chevronRight), h('span', {}, `Comments (${waiting.length})`), ...(sent > 0 ? [h('span', { class: 'files-comments-sent' }, `${sent} sent`)] : []))
    this.list.replaceChildren(...rows.map((row) => this.row(row)))
  }

  private row(row: CommentRow): HTMLElement {
    const actions = row.sent || row.reviewer ? [] : [
      h('button', { class: 'icon-btn small', type: 'button', title: 'Edit comment', 'aria-label': `Edit comment on ${refOf(row)}`, onClick: () => this.hooks.edit(row.id) }, 'Edit'),
      h('button', { class: 'icon-btn small', type: 'button', title: 'Delete comment', 'aria-label': `Delete comment on ${refOf(row)}`, onClick: () => this.hooks.remove(row.id) }, 'Delete')
    ]
    return h('div', { class: `files-comment-row${row.sent ? ' sent' : ''}`, role: 'listitem', 'data-comment-id': row.id },
      h('button', { class: 'files-comment-jump', type: 'button', title: row.path, onClick: () => this.hooks.jump(row.id) },
        h('span', { class: 'files-comment-ref' }, refOf(row)),
        h('span', { class: 'files-comment-text', dir: 'auto' }, row.text.replace(/\s+/g, ' ')),
        ...(row.outdated ? [h('span', { class: 'files-comment-flag' }, 'Outdated')] : row.sent ? [h('span', { class: 'files-comment-flag' }, 'Sent')] : [])),
      ...actions)
  }
}
