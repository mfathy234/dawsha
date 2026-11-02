import { h, icon } from '../dom'
import { foldRows, type UntrackedFolder } from '../../shared/gitIgnore'
import { openContextMenu } from '../components/contextMenu'
import { ICONS } from '../icons'
import { fileIcon } from './fileIcon'
import { newFolderRow, toggleFolderOpen } from './newFolders'

export interface ReviewFile {
  path: string
  letter: string
  added: number | null
  removed: number | null
}

export interface ReviewModel {
  files: ReviewFile[]
  current: string | null
  viewed: ReadonlySet<string>
  commentCounts: ReadonlyMap<string, number>
  commentTotal: number
  note: string
  /** Folders of new files that fold into one row. */
  newFolders?: readonly UntrackedFolder[]
}

export interface ReviewHooks {
  open(path: string): void
  toggleViewed(path: string, viewed: boolean): void
  step(direction: 1 | -1): void
  note(text: string): void
  send(anchor: HTMLElement): void
  commit(): void
  discard(path: string): void
  ignoreFolder(folder: UntrackedFolder): void
  /** List the callers and implementations of changed symbols that the agents did not touch. */
  stale(): void
}

const minus = '−'
const BADGE_TITLES: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', U: 'New (untracked)', R: 'Renamed', C: 'Copied', T: 'Type changed', '!': 'Conflict' }

const split = (path: string): { name: string; folder: string } => {
  const cut = path.lastIndexOf('/')
  return { name: path.slice(cut + 1), folder: cut < 0 ? '' : path.slice(0, cut) }
}

/** Review: step through the changed files, tick them as viewed, then send the comments, commit or discard. */
export class ReviewPanel {
  readonly el = h('div', { class: 'files-pane files-pane-review' })
  private readonly progress = h('div', { class: 'files-review-progress', id: 'files-review-progress', role: 'status', 'aria-live': 'polite' })
  private readonly list = h('div', { class: 'files-review-list', id: 'files-review-list', role: 'list', 'aria-label': 'Changed files' })
  private readonly prev = h('button', { class: 'icon-btn', type: 'button', id: 'files-review-prev', disabled: true, title: 'Previous file (P)', 'aria-label': 'Previous file', onClick: () => this.hooks.step(-1) }, icon(ICONS.chevronUp))
  private readonly next = h('button', { class: 'icon-btn', type: 'button', id: 'files-review-next', disabled: true, title: 'Next file (N)', 'aria-label': 'Next file', onClick: () => this.hooks.step(1) }, icon(ICONS.chevronDown))
  private readonly note = h('textarea', {
    class: 'files-review-note', id: 'files-review-note', rows: '3', placeholder: 'Overall note for the agent', 'aria-label': 'Overall note for the agent',
    onInput: (event: Event) => this.hooks.note((event.target as HTMLTextAreaElement).value)
  })
  private readonly noteToggle = h('button', { class: 'btn small ghost', type: 'button', id: 'files-review-note-toggle', 'aria-expanded': 'false', 'aria-controls': 'files-review-note', onClick: () => this.setNoteOpen(!this.noteOpen) }, 'Note to agent')
  private readonly send = h('button', { class: 'btn small secondary', type: 'button', id: 'files-review-send', disabled: true, onClick: (event: Event) => this.hooks.send(event.currentTarget as HTMLElement) }, 'Send note to agent')
  private readonly more = h('button', { class: 'icon-btn', type: 'button', id: 'files-review-more', 'aria-haspopup': 'menu', title: 'More review actions', 'aria-label': 'More review actions', onClick: () => this.openMenu() }, icon(ICONS.more))
  private readonly commit = h('button', { class: 'btn small primary', type: 'button', id: 'files-review-commit', disabled: true, onClick: () => this.hooks.commit() }, 'Commit…')
  private current: string | null = null
  private last: ReviewModel | null = null
  private noteOpen = false
  private readonly head = h('div', { class: 'files-review-head' })
  private readonly foot = h('div', { class: 'files-review-foot' })

  constructor(private readonly hooks: ReviewHooks) {
    this.el.append(this.head, this.list, this.foot)
    this.head.append(this.progress, this.prev, this.next)
    this.note.hidden = true
    this.foot.append(this.note, this.send, h('div', { class: 'files-review-actions' }, this.noteToggle, this.more, this.commit))
    this.list.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const rows = [...this.list.querySelectorAll<HTMLElement>('.files-review-open')]
      const at = rows.indexOf(document.activeElement as HTMLElement)
      if (at < 0) return
      event.preventDefault()
      rows[Math.min(Math.max(at + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)]?.focus()
    })
  }

  private setNoteOpen(open: boolean, focus = true): void {
    this.noteOpen = open
    this.note.hidden = !open
    this.noteToggle.setAttribute('aria-expanded', String(open))
    if (this.last) this.send.hidden = !open && this.last.commentTotal === 0
    if (open && focus) this.note.focus()
  }

  private openMenu(): void {
    const model = this.last
    const path = model?.current && model.files.some((file) => file.path === model.current) ? model.current : null
    const rect = this.more.getBoundingClientRect()
    openContextMenu({
      x: rect.left, y: rect.bottom, anchor: rect, label: 'More review actions', returnFocus: this.more,
      entries: [
        { label: 'Callers not updated…', detail: 'Callers and implementations of changed symbols that were not updated', run: () => this.hooks.stale() },
        'separator',
        { label: path ? `Discard ${split(path).name}…` : 'Discard file…', detail: path ? undefined : 'Select a changed file to discard it', disabled: path === null, run: () => path && this.hooks.discard(path) }
      ]
    })
  }

  focus(): void {
    const target = this.list.querySelector<HTMLElement>('.files-review-row.current .files-review-open') ?? this.list.querySelector<HTMLElement>('.files-review-open')
    target?.focus()
  }

  render(model: ReviewModel): void {
    this.current = model.current
    this.last = model
    const total = model.files.length
    const done = model.files.filter((file) => model.viewed.has(file.path)).length
    this.progress.textContent = total === 0 ? 'Nothing to review. The agents have not changed any files yet.' : `${done} of ${total} viewed`
    // With nothing to review, the stepping buttons and the note, commit and discard controls have nothing to act on.
    this.head.classList.toggle('empty', total === 0)
    this.prev.hidden = total === 0
    this.next.hidden = total === 0
    this.foot.hidden = total === 0
    this.prev.disabled = total === 0
    this.next.disabled = total === 0
    this.commit.disabled = total === 0
    if (model.note.trim() !== '' && !this.noteOpen) this.setNoteOpen(true, false)
    const count = model.commentTotal
    this.send.disabled = count === 0 && model.note.trim() === ''
    this.send.textContent = count > 0 ? `Send ${count} comment${count === 1 ? '' : 's'} to agent` : 'Send note to agent'
    // Comments can be sent without opening the note, so the button also shows while any exist.
    this.send.hidden = !this.noteOpen && count === 0
    this.noteToggle.classList.toggle('has-note', model.note.trim() !== '')
    if (this.note.value !== model.note) this.note.value = model.note
    const hooks = { toggle: (path: string) => { toggleFolderOpen(path); if (this.last) this.render(this.last) }, ignore: (folder: UntrackedFolder) => this.hooks.ignoreFolder(folder) }
    this.list.replaceChildren(...foldRows(model.files, model.newFolders ?? []).map((item) => item.kind === 'file'
      ? this.fileRow(item.row, model)
      : newFolderRow(item.folder, hooks, item.rows.map((file) => this.fileRow(file, model)))))
  }

  private fileRow(file: ReviewFile, model: ReviewModel): HTMLElement {
    const { name, folder } = split(file.path)
    const viewed = model.viewed.has(file.path)
    const comments = model.commentCounts.get(file.path) ?? 0
    const tick = h('input', { class: 'files-review-tick', type: 'checkbox', 'aria-label': `Viewed: ${file.path}`, 'data-path': file.path, onChange: (event: Event) => this.hooks.toggleViewed(file.path, (event.target as HTMLInputElement).checked) })
    tick.checked = viewed
    return h('div', { class: `files-review-row${file.path === model.current ? ' current' : ''}${viewed ? ' viewed' : ''}`, role: 'listitem', 'data-path': file.path },
      tick,
      h('button', { class: 'files-review-open', type: 'button', title: file.path, 'aria-current': file.path === model.current ? 'true' : undefined, onClick: () => this.hooks.open(file.path) },
        fileIcon(file.path), h('span', { class: 'files-flat-name' }, name), folder ? h('span', { class: 'files-flat-dir' }, folder) : null),
      comments > 0 ? h('span', { class: 'files-review-comments', title: `${comments} comment${comments === 1 ? '' : 's'}` }, `${comments} comment${comments === 1 ? '' : 's'}`) : null,
      file.added !== null || file.removed !== null ? h('span', { class: 'files-review-stat' }, h('span', { class: 'plus' }, `+${file.added ?? 0}`), ' ', h('span', { class: 'minus' }, `${minus}${file.removed ?? 0}`)) : null,
      h('span', { class: `files-badge b-${file.letter === 'U' ? 'A' : file.letter}`, title: BADGE_TITLES[file.letter] ?? file.letter }, file.letter === 'U' ? 'A' : file.letter),
      viewed ? h('span', { class: 'files-review-done' }, 'Viewed') : null)
  }
}
