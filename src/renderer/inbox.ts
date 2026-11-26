import { inboxOrder, INBOX_CHOICES_MAX, stateWait, type InboxEntry } from '../shared/inbox'
import { askedText, replyLines } from '../shared/miniDetail'
import { miniSession, miniStateOf } from '../shared/miniWindow'
import { miniWaiting } from '../shared/miniWaiting'
import { detectPermissionPrompt, parsePermissionDetail } from '../shared/permissionPrompt'
import { parseMenuPrompt } from '../shared/menuPrompt'
import { detectTerminalMenu } from '../shared/terminalMenu'
import { replySnippet } from '../shared/notifyContent'
import type { SessionState } from '../shared/sessionState'
import { answerPermission, permissionTail } from './actions'
import { api } from './api'
import { derivePanes, primaryTab, type PaneView } from './derive'
import { sessionNote } from './sessionNotes'
import { stateSince } from './stateClock'
import { store, type AppState } from './state'
import { getTerminal } from './terminals'
import { timelineRequest } from './timelineActions'

export interface InboxChoice {
  number: number
  label: string
}

export interface InboxItem extends InboxEntry {
  view: PaneView
  line: string
  waitText: string
  /** What the session waits on besides a permission, empty for a finished one. */
  question: string
  choices: InboxChoice[]
  /** A numbered answer can be given from here. */
  answerable: boolean
  note: string
}

export interface InboxDetail {
  asked: string
  reply: string[]
}

const NUMBERED = /^(\d+)\.\s+(.*)$/

// A terminal repaint can clear the prompt while the session still waits, so the inbox keeps what it last read until the wait ends.
const lastAsk = new Map<string, { question: string; choices: InboxChoice[] }>()

function choicesOf(tail: string, labels: readonly string[]): InboxChoice[] {
  if (detectPermissionPrompt(tail)) return parsePermissionDetail(tail).options.slice(0, INBOX_CHOICES_MAX).map((option) => ({ number: option.number, label: option.label }))
  return labels.flatMap((label) => {
    const match = NUMBERED.exec(label)
    return match ? [{ number: Number(match[1]), label: match[2] }] : []
  }).filter((choice) => choice.number <= INBOX_CHOICES_MAX)
}

function replyOf(view: PaneView): string[] {
  const tab = primaryTab(view.pane)
  const copy = getTerminal(tab.id)?.prompts.replyText()
  if (!copy || copy.fromScreen) return []
  return replyLines(copy.text)
}

/** The sessions that need the owner or finished unseen, in the order the inbox lists them. */
export function inboxItems(state: AppState): InboxItem[] {
  const items = derivePanes(state).filter((view) => !view.snoozed && view.agent !== 'shell').map((view): InboxItem => {
    const paneId = view.pane.id
    const tail = permissionTail(paneId)
    const reply = replyOf(view)
    const note = sessionNote(paneId)
    const shaped = miniSession({
      paneId, agent: view.agent, title: view.title, project: view.project?.name ?? '', status: view.status, attention: view.attention,
      tail, recap: note.recap, tool: note.tool, idleFor: '', changed: view.info.changes?.files ?? null, todos: [], reply, unread: view.unread
    })
    const needs = miniStateOf({ status: view.status, attention: view.attention, tail }).state === 'needs'
    const state2: SessionState = needs ? 'needs' : shaped.state
    const waiting = needs && !shaped.permission ? miniWaiting(tail, reply) : null
    const read = needs ? choicesOf(tail, waiting?.choices ?? []) : []
    const held = needs ? lastAsk.get(paneId) : undefined
    const choices = read.length > 0 ? read : (held?.choices ?? [])
    const snippet = reply.length > 0 ? replySnippet(reply.join(' ')) : null
    return {
      paneId, state: state2, unread: view.unread, since: stateSince(paneId, state2, state.now), view,
      line: needs ? shaped.line : (reply[0] ?? snippet ?? shaped.line),
      waitText: stateWait({ state: state2, since: stateSince(paneId, state2, state.now), now: state.now }),
      question: needs ? (shaped.permission ? shaped.line : (waiting?.question ?? held?.question ?? '')) : '',
      choices,
      answerable: needs && choices.length > 0,
      note: view.pane.care?.note?.text ?? ''
    }
  })
  for (const item of items) {
    if (item.state === 'needs') lastAsk.set(item.paneId, { question: item.question, choices: item.choices })
    else lastAsk.delete(item.paneId)
  }
  return inboxOrder(items)
}

/** What the owner asked and the start of the reply, from the session's log; empty while it cannot be read. */
export async function loadInboxDetail(paneId: string): Promise<InboxDetail | null> {
  const request = timelineRequest(paneId)
  if (!request) return null
  const result = await api.sessionTimeline({ ...request, version: undefined }).catch(() => null)
  if (result?.status !== 'ok') return null
  const prompt = result.events.findLast((event) => event.kind === 'prompt')
  const reply = result.events.findLast((event) => event.kind === 'reply')
  return { asked: prompt ? askedText(prompt.text) : '', reply: reply ? replyLines(reply.text) : [] }
}

/** Answers the numbered question a session shows: a permission prompt through the same path Mini and notifications use, or a menu. */
export function answerInbox(paneId: string, number: number): boolean {
  const tail = permissionTail(paneId)
  if (detectPermissionPrompt(tail)) return answerPermission(paneId, number)
  if (!parseMenuPrompt(tail) && !detectTerminalMenu(tail)) return false
  const view = derivePanes(store.state).find((candidate) => candidate.pane.id === paneId)
  if (!view || number < 1 || number > INBOX_CHOICES_MAX) return false
  api.write(view.primaryTabId, String(number))
  return true
}
