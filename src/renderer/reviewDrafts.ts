import { buildDraftMessage, keepDrafts, makeDraft, markSent, sendable, type MessageOptions, type NewDraft, type ReviewDraft } from '../shared/reviewDrafts'
import { miniSendRefusal } from '../shared/miniSend'
import { permissionTail, saveSettings } from './actions'
import { sendChatMessage } from './chat/chatActions'
import { toast } from './components/toast'
import { derivePanes, primaryTab } from './derive'
import { store } from './state'

type Listener = () => void

const listeners = new Set<Listener>()
/** Comments open in a text box (new, or being edited). Never saved. */
const editing = new Set<string>()

export const onDraftsChange = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const notify = (): void => {
  for (const listener of listeners) listener()
}

export const allDrafts = (): readonly ReviewDraft[] => store.state.settings.reviewDrafts

export const draftsOf = (folder: string): ReviewDraft[] => allDrafts().filter((draft) => draft.folder === folder)

export const isEditing = (id: string): boolean => editing.has(id)

function write(drafts: readonly ReviewDraft[]): void {
  const reviewDrafts = keepDrafts(drafts)
  store.set((state) => ({ ...state, settings: { ...state.settings, reviewDrafts } }))
  void saveSettings({ reviewDrafts })
  notify()
}

/** Adds a comment and opens it for typing. */
export function addDraft(input: NewDraft): ReviewDraft {
  const draft = makeDraft(input, crypto.randomUUID(), Date.now())
  if (draft.text === '') editing.add(draft.id)
  write([...allDrafts(), draft])
  return draft
}

/** Adds finished comments (a reviewer's findings) in one save. */
export function addDrafts(inputs: readonly NewDraft[]): ReviewDraft[] {
  const made = inputs.map((input) => makeDraft(input, crypto.randomUUID(), Date.now()))
  if (made.length > 0) write([...allDrafts(), ...made])
  return made
}

export function startEditing(id: string): void {
  editing.add(id)
  notify()
}

export function stopEditing(id: string): void {
  editing.delete(id)
  notify()
}

/** Changes one comment; returning null removes it. */
export function changeDraft(id: string, change: (draft: ReviewDraft) => ReviewDraft | null): void {
  editing.delete(id)
  write(allDrafts().flatMap((draft) => (draft.id !== id ? [draft] : (change(draft) ?? []))))
}

export function removeDrafts(match: (draft: ReviewDraft) => boolean): void {
  const left = allDrafts().filter((draft) => !match(draft))
  if (left.length !== allDrafts().length) write(left)
}

/** Moves comments to the lines their text is on now; one save for all of them. */
export function reanchor(moves: ReadonlyMap<string, { line: number; snippet: string[] }>): void {
  if (moves.size === 0) return
  write(allDrafts().map((draft) => (moves.has(draft.id) ? { ...draft, ...moves.get(draft.id)! } : draft)))
}

export interface SendTarget {
  paneId: string
  title: string
  agent: string
}

/** Why a message cannot go to this session right now, or null. */
export function sendRefusal(paneId: string): string | null {
  const view = derivePanes(store.state).find((candidate) => candidate.pane.id === paneId)
  const tab = view ? primaryTab(view.pane) : null
  if (!view || !tab) return 'That session is not open any more.'
  if (tab.agent === 'shell') return 'Review comments only go to agent sessions.'
  return miniSendRefusal({ agent: tab.agent, status: tab.status, tail: permissionTail(paneId) })
}

/** Sends text to a session the way the chat box does. False (with a note) when the session cannot take it. */
export function deliver(target: SendTarget, body: string): boolean {
  const refusal = sendRefusal(target.paneId)
  if (refusal) {
    toast(refusal, 'info')
    return false
  }
  const view = derivePanes(store.state).find((candidate) => candidate.pane.id === target.paneId)
  const tab = view ? primaryTab(view.pane) : null
  if (!view || !tab) return false
  // A prompt can appear between typing and the delayed Enter; that Enter would approve it.
  sendChatMessage(tab.id, tab.agent, body, () => {
    const late = sendRefusal(target.paneId)
    if (late) toast(late, 'info')
    return !late
  })
  return true
}

/** Sends the open comments to a session as one message, then marks them sent. */
export function sendDrafts(target: SendTarget, drafts: readonly ReviewDraft[], options: MessageOptions = {}): boolean {
  const ready = sendable(drafts)
  const note = (options.note ?? '').trim()
  const body = buildDraftMessage(ready, options) || (note === '' ? '' : `Review note: ${note}`)
  if (body === '' || !deliver(target, body)) return false
  write(markSent(allDrafts(), new Set(ready.map((draft) => draft.id)), Date.now()))
  const count = ready.length
  toast(count > 0 ? `Sent ${count} comment${count === 1 ? '' : 's'} to ${target.title}.` : `Sent your note to ${target.title}.`, 'info')
  return true
}
