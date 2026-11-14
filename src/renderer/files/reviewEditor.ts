import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state'
import { getChunks } from '@codemirror/merge'
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, type DecorationSet } from '@codemirror/view'
import { formatClock } from '../../shared/timeline'
import type { LineBlame } from '../../shared/fileActivity'
import { agentMark } from '../components/agentMark'
import type { ReviewDraft } from '../../shared/reviewDrafts'
import { addedLinesOf } from './editor'

export interface DraftComment extends ReviewDraft {
  /** The comment is open in a text box: new, or being edited. */
  editing?: boolean
}

export interface ReviewAnnotations {
  comments: readonly DraftComment[]
  blame: ReadonlyMap<number, LineBlame>
  /** Who the reviewer's findings go back to, for the button label. */
  authorName: string
  onAdd(line: number, endLine?: number): void
  onSendFinding(id: string): void
  onDismiss(id: string): void
  onEdit(id: string): void
  onSave(id: string, text: string): void
  onCancel(id: string): void
  onDelete(id: string): void
}

const addedCache = new WeakMap<object, ReadonlySet<number>>()

const NONE: ReadonlySet<number> = new Set()

function addedSet(state: EditorState): ReadonlySet<number> {
  const chunks = getChunks(state)
  if (!chunks) return NONE
  const known = addedCache.get(chunks)
  if (known) return known
  const set = new Set(addedLinesOf(state))
  addedCache.set(chunks, set)
  return set
}

class AddMarker extends GutterMarker {
  constructor(private readonly line: number) {
    super()
  }

  override eq(other: AddMarker): boolean {
    return other.line === this.line
  }

  override toDOM(): HTMLElement {
    const mark = document.createElement('span')
    mark.className = 'cm-review-add'
    mark.textContent = '+'
    mark.title = 'Add a review comment on this line'
    mark.setAttribute('role', 'button')
    mark.setAttribute('aria-label', `Add a review comment on line ${this.line}`)
    return mark
  }
}

class BlameMarker extends GutterMarker {
  constructor(private readonly blame: LineBlame) {
    super()
  }

  override eq(other: BlameMarker): boolean {
    return other.blame.key === this.blame.key && other.blame.at === this.blame.at && other.blame.task === this.blame.task && other.blame.exact === this.blame.exact
  }

  override toDOM(): HTMLElement {
    const mark = document.createElement('span')
    mark.className = 'cm-blame-mark'
    const agent = this.blame.agent
    const logo = agent === 'claude' || agent === 'codex' || agent === 'gemini' ? agentMark(agent) : null
    if (logo) mark.append(logo)
    else mark.textContent = this.blame.label.trim().slice(0, 1).toUpperCase() || '?'
    const when = this.blame.at > 0 ? ` at ${formatClock(this.blame.at)}` : ''
    const text = `${this.blame.label}${this.blame.task ? `: ${this.blame.task}` : ''}${when}`
    mark.title = this.blame.exact ? text : `About: ${text}`
    mark.setAttribute('aria-label', this.blame.exact ? `Written by ${text}` : `About, written by ${text}`)
    mark.classList.toggle('estimated', !this.blame.exact)
    return mark
  }
}

class CommentWidget extends WidgetType {
  constructor(private readonly comment: DraftComment, private readonly hooks: ReviewAnnotations) {
    super()
  }

  override eq(other: CommentWidget): boolean {
    return other.comment.id === this.comment.id && other.comment.text === this.comment.text && other.comment.editing === this.comment.editing && other.comment.line === this.comment.line && other.comment.endLine === this.comment.endLine && other.comment.status === this.comment.status && other.hooks.authorName === this.hooks.authorName
  }

  override ignoreEvent(): boolean {
    return true
  }

  override toDOM(): HTMLElement {
    const { comment, hooks } = this
    const box = document.createElement('div')
    box.className = 'cm-review-comment'
    box.dataset.commentId = comment.id
    const button = (label: string, run: () => void, extra = ''): HTMLButtonElement => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `btn small ${extra}`.trim()
      el.textContent = label
      el.addEventListener('click', run)
      return el
    }
    if (comment.editing) {
      const field = document.createElement('textarea')
      field.className = 'cm-review-input'
      field.rows = 2
      field.value = comment.text
      field.placeholder = `Comment on ${lineLabel(comment)}`
      field.setAttribute('aria-label', `Comment on ${lineLabel(comment)}`)
      const save = (): void => hooks.onSave(comment.id, field.value)
      field.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          hooks.onCancel(comment.id)
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          save()
        }
      })
      const actions = document.createElement('div')
      actions.className = 'cm-review-actions'
      actions.append(button('Save comment', save), button('Cancel', () => hooks.onCancel(comment.id)))
      box.append(field, actions)
      queueMicrotask(() => field.focus())
      return box
    }
    const text = document.createElement('div')
    text.className = 'cm-review-text'
    text.textContent = comment.text
    text.dir = 'auto'
    const actions = document.createElement('div')
    actions.className = 'cm-review-actions'
    if (comment.reviewer) {
      const head = document.createElement('div')
      head.className = `cm-review-head sev-${comment.reviewer.severity}`
      head.textContent = `Review by ${comment.reviewer.agent}, ${comment.reviewer.severity}`
      box.append(head)
    }
    box.classList.toggle('sent', comment.status === 'sent')
    if (comment.status === 'sent') {
      const sent = document.createElement('div')
      sent.className = 'cm-review-sent'
      sent.textContent = 'Sent'
      box.append(text, sent)
      return box
    }
    box.append(text)
    if (comment.reviewer?.fix) {
      const fix = document.createElement('div')
      fix.className = 'cm-review-fix'
      fix.dir = 'auto'
      fix.textContent = `Suggested fix: ${comment.reviewer.fix}`
      box.append(fix)
    }
    if (comment.author === 'reviewer') actions.append(button(`Send to ${hooks.authorName}`, () => hooks.onSendFinding(comment.id)), button('Dismiss', () => hooks.onDismiss(comment.id)))
    else actions.append(button('Edit', () => hooks.onEdit(comment.id)), button('Delete', () => hooks.onDelete(comment.id)))
    box.append(actions)
    return box
  }
}

const lineLabel = (comment: DraftComment): string => (comment.endLine ? `lines ${comment.line} to ${comment.endLine}` : `line ${comment.line}`)

function widgets(state: EditorState, hooks: ReviewAnnotations): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const ordered = [...hooks.comments].filter((comment) => comment.line >= 1).sort((a, b) => a.line - b.line)
  for (const comment of ordered) {
    const line = state.doc.line(Math.min(comment.endLine ?? comment.line, state.doc.lines))
    builder.add(line.to, line.to, Decoration.widget({ widget: new CommentWidget(comment, hooks), block: true, side: 1 }))
  }
  return builder.finish()
}

/** The Changes view's extras: a + on every added line, a mark for who wrote it, and the comments under their lines. */
export function reviewExtension(hooks: ReviewAnnotations): Extension {
  const lineNumber = (state: EditorState, from: number): number => state.doc.lineAt(from).number
  const field = StateField.define<DecorationSet>({
    create: (state) => widgets(state, hooks),
    update: (value, tr) => (tr.docChanged ? widgets(tr.state, hooks) : value),
    provide: (f) => EditorView.decorations.from(f)
  })
  const add = gutter({
    class: 'cm-review-gutter',
    lineMarker: (view, line) => (addedSet(view.state).has(lineNumber(view.state, line.from)) ? new AddMarker(lineNumber(view.state, line.from)) : null),
    lineMarkerChange: () => true,
    domEventHandlers: {
      click(view, line) {
        const number = lineNumber(view.state, line.from)
        if (!addedSet(view.state).has(number)) return false
        const { from, to } = view.state.selection.main
        const first = lineNumber(view.state, from)
        const last = lineNumber(view.state, to)
        if (to > from && number >= first && number <= last && last > first) hooks.onAdd(first, last)
        else hooks.onAdd(number)
        return true
      }
    }
  })
  const blame = gutter({
    class: 'cm-blame-gutter',
    lineMarker: (view, line) => {
      const number = lineNumber(view.state, line.from)
      const found = hooks.blame.get(number)
      return found && addedSet(view.state).has(number) ? new BlameMarker(found) : null
    },
    lineMarkerChange: () => true
  })
  return [field, blame, add]
}
