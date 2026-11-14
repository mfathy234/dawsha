import { lineHash, type ReviewDraft } from '../../shared/reviewDrafts'
import type { TurnDiff, TurnDiffRow } from '../../shared/turnDiff'
import { confirmDialog } from '../components/dialogs'
import { h } from '../dom'
import { addDraft, changeDraft, draftsOf, isEditing, startEditing, stopEditing } from '../reviewDrafts'

export interface CardComments {
  folder: string
  paneId: string | null
}

const SIGN = (kind: string): string => (kind === 'add' ? '+' : ' ')

function snippetFor(diff: TurnDiff, at: number): string[] {
  const rows: string[] = []
  for (const row of diff.rows.slice(Math.max(0, at - 1), at + 2)) if (row.k !== 'hunk') rows.push(`${SIGN(row.k)} ${row.t}`)
  return rows
}

/** The "+" in a diff row's gutter: adds a comment on that line of the file. */
export function commentButton(comments: CardComments, path: string, diff: TurnDiff, at: number): HTMLElement | null {
  const row = diff.rows[at]
  if (row.new === undefined || row.k === 'del') return null
  const line = row.new
  return h('button', {
    class: 'turn-cm-add', type: 'button', title: 'Add a review comment on this line', 'aria-label': `Add a review comment on line ${line}`,
    onClick: () => addDraft({ folder: comments.folder, ...(comments.paneId ? { paneId: comments.paneId } : {}), path, line, lineText: row.t, snippet: snippetFor(diff, at), text: '' })
  }, '+')
}

async function remove(draft: ReviewDraft): Promise<void> {
  const confirmed = await confirmDialog({ title: 'Delete this comment?', body: `${draft.path}:${draft.line}\n${draft.text}`, confirmLabel: `Delete comment on line ${draft.line}` })
  if (confirmed) changeDraft(draft.id, () => null)
}

function box(draft: ReviewDraft): HTMLElement {
  const button = (label: string, run: () => void): HTMLElement => h('button', { class: 'btn small', type: 'button', onClick: run }, label)
  if (isEditing(draft.id)) {
    const field = h('textarea', { rows: '2', dir: 'auto', placeholder: `Comment on line ${draft.line}`, 'aria-label': `Comment on line ${draft.line}` })
    field.value = draft.text
    const save = (): void => changeDraft(draft.id, (current) => (field.value.trim() === '' ? null : { ...current, text: field.value.trim() }))
    const cancel = (): void => (draft.text.trim() === '' ? changeDraft(draft.id, () => null) : stopEditing(draft.id))
    field.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') cancel()
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save()
    })
    queueMicrotask(() => field.focus())
    return h('div', { class: 'turn-cm', 'data-comment-id': draft.id }, field, h('div', { class: 'turn-cm-actions' }, button('Save comment', save), button('Cancel', cancel)))
  }
  const sent = draft.status === 'sent'
  return h('div', { class: 'turn-cm', 'data-comment-id': draft.id },
    h('div', { class: `turn-cm-text${sent ? ' sent' : ''}`, dir: 'auto' }, draft.text),
    sent ? h('div', { class: 'chat-quiet' }, 'Sent') : h('div', { class: 'turn-cm-actions' }, button('Edit', () => startEditing(draft.id)), button('Delete', () => void remove(draft))))
}

/** The comments saved on a row's line, when the line still reads the same. */
export function commentBoxes(comments: CardComments, path: string, row: TurnDiffRow): HTMLElement[] {
  if (row.new === undefined || row.k === 'del') return []
  const hash = lineHash(row.t)
  return draftsOf(comments.folder)
    .filter((draft) => draft.path === path && draft.line === row.new && draft.status !== 'dismissed' && (draft.hash === '' || draft.hash === hash))
    .map(box)
}
