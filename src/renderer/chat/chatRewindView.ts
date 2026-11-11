import { timeLabel } from '../../shared/chatTime'
import { REWIND_TEXT } from '../../shared/rewindStrings'
import { h } from '../dom'
import './chatRewind.css'

/** What the thread needs to draw rewind, edit and try-again; the controller owns the state behind it. */
export interface RewindView {
  /** Edit and Rewind wait for the agent to finish. */
  working: boolean
  /** Whether a snapshot was taken before this message. */
  hasSnapshot(messageId: string): boolean
  edit(messageId: string): void
  rewind(messageId: string): void
  tryAgain(messageId: string): void
  copy(messageId: string): void
  /** The message being edited, and the box that replaces its bubble. */
  editing: { id: string; el: HTMLElement } | null
  /** A rewind that was just done. */
  mark: { messageId: string; time: string | null; count: number; redo(): void } | null
  /** Set on a session started with Try another way. */
  tried: { title: string; at: number | undefined; number: number; compare(): void } | null
}

function action(label: string, run: () => void, disabledTitle: string | null): HTMLElement {
  return h('button', { class: 'chat-text-btn', type: 'button', disabled: disabledTitle !== null, title: disabledTitle ?? undefined, onClick: (event: Event) => { event.stopPropagation(); run() } }, label)
}

/** The quiet row under a message you sent: time, Edit, Rewind to here, Try another way, Copy. */
export function messageActions(messageId: string, at: number | undefined, view: RewindView): HTMLElement {
  const snapshot = view.hasSnapshot(messageId)
  const why = (needsIdle: boolean): string | null => (!snapshot ? REWIND_TEXT.noSnapshot : needsIdle && view.working ? REWIND_TEXT.stopFirst : null)
  return h('div', { class: 'chat-msg-acts', role: 'group', 'aria-label': REWIND_TEXT.actionsLabel },
    at !== undefined ? h('span', { class: 'chat-msg-time' }, timeLabel(at)) : null,
    action(REWIND_TEXT.edit, () => view.edit(messageId), why(true)),
    action(REWIND_TEXT.rewind, () => view.rewind(messageId), why(true)),
    action(REWIND_TEXT.tryAgain, () => view.tryAgain(messageId), why(false)),
    action(REWIND_TEXT.copy, () => view.copy(messageId), null))
}

const STAYS = '.chat-working, .pending'

function rewoundLine(mark: NonNullable<RewindView['mark']>): HTMLElement {
  return h('div', { class: 'chat-rewind-mark', role: 'status' }, h('span', {}, REWIND_TEXT.rewound(mark.time, mark.count)), h('button', { class: 'chat-text-btn', type: 'button', onClick: mark.redo }, REWIND_TEXT.redo))
}

function triedLine(tried: NonNullable<RewindView['tried']>): HTMLElement {
  return h('div', { class: 'chat-tried chat-quiet' }, h('span', {}, REWIND_TEXT.tried(tried.title, tried.at === undefined ? null : timeLabel(tried.at)), ' · '), h('button', { class: 'chat-text-btn', type: 'button', onClick: tried.compare }, REWIND_TEXT.compare(tried.number - 1)))
}

/** After the thread is drawn: the "tried from" line, the Rewound line and the dimming of the turns that were or will be replaced. */
export function decorateRewind(thread: HTMLElement, view: RewindView | undefined): void {
  if (!view) return
  const kids = [...thread.children] as HTMLElement[]
  const dimId = view.editing?.id ?? view.mark?.messageId
  const at = dimId ? kids.findIndex((kid) => kid.dataset.msgId === dimId) : -1
  if (at >= 0) {
    const from = view.editing ? at + 1 : at
    kids.slice(from).filter((kid) => !kid.matches(STAYS)).forEach((kid) => kid.classList.add('chat-undone'))
    if (view.mark && !view.editing) kids[at].before(rewoundLine(view.mark))
  }
  if (view.tried) thread.prepend(triedLine(view.tried))
}
