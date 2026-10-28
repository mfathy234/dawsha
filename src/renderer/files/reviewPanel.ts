import { h } from '../dom'
import { fileIcon } from './fileIcon'

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
}

export interface ReviewHooks {
  open(path: string): void
  toggleViewed(path: string, viewed: boolean): void
  step(direction: 1 | -1): void
  note(text: string): void
  send(anchor: HTMLElement): void
  commit(): void
  discard(path: string): void
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
  private readonly prev = h('button', { class: 'btn small', type: 'button', id: 'files-review-prev', title: 'Previous file (P)', onClick: () => this.hooks.step(-1) }, 'Previous')
  private readonly next = h('button', { class: 'btn small', type: 'button', id: 'files-review-next', title: 'Next file (N)', onClick: () => this.hooks.step(1) }, 'Next')
  private readonly note = h('textarea', {
    class: 'files-review-note', id: 'files-review-note', rows: '2', placeholder: 'Overall note (optional)', 'aria-label': 'Overall note for the agent',
    onInput: (event: Event) => this.hooks.note((event.target as HTMLTextAreaElement).value)
  })
  private readonly send = h('button', { class: 'btn small primary', type: 'button', id: 'files-review-send', onClick: (event: Event) => this.hooks.send(event.currentTarget as HTMLElement) }, 'Send comments to agent')
  private readonly commit = h('button', { class: 'btn small', type: 'button', id: 'files-review-commit', onClick: () => this.hooks.commit() }, 'Commit…')
  private readonly discard = h('button', { class: 'btn small', type: 'button', id: 'files-review-discard', onClick: () => this.current && this.hooks.discard(this.current) }, 'Discard file…')
  private current: string | null = null

  constructor(private readonly hooks: ReviewHooks) {
    this.el.append(
      this.progress,
      h('div', { class: 'files-review-steps' }, this.prev, this.next),
      this.list,
      h('div', { class: 'files-review-foot' }, this.note, this.send, h('div', { class: 'files-review-more' }, this.commit, this.discard)))
    this.list.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const rows = [...this.list.querySelectorAll<HTMLElement>('.files-review-open')]
      const at = rows.indexOf(document.activeElement as HTMLElement)
      if (at < 0) return
      event.preventDefault()
      rows[Math.min(Math.max(at + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)]?.focus()
    })
  }

  focus(): void {
    const target = this.list.querySelector<HTMLElement>('.files-review-row.current .files-review-open') ?? this.list.querySelector<HTMLElement>('.files-review-open')
    target?.focus()
  }

  render(model: ReviewModel): void {
    this.current = model.current
    const total = model.files.length
    const done = model.files.filter((file) => model.viewed.has(file.path)).length
    this.progress.textContent = total === 0 ? 'Nothing to review. The agents have not changed any files yet.' : `${done} of ${total} viewed`
    this.prev.disabled = total === 0
    this.next.disabled = total === 0
    this.commit.disabled = total === 0
    this.discard.disabled = !model.current || !model.files.some((file) => file.path === model.current)
    this.discard.textContent = model.current && !this.discard.disabled ? `Discard ${split(model.current).name}…` : 'Discard file…'
    this.send.disabled = model.commentTotal === 0 && model.note.trim() === ''
    this.send.textContent = model.commentTotal > 0 ? `Send ${model.commentTotal} comment${model.commentTotal === 1 ? '' : 's'} to agent` : 'Send note to agent'
    if (this.note.value !== model.note) this.note.value = model.note
    this.list.replaceChildren(...model.files.map((file) => {
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
    }))
  }
}
