import { limitTitle, notifyAtLabel, resetLine, resetsLater, sendAtLabel, type LimitSituation } from '../../shared/chatLimit'
import { CHAT_TEXT } from '../../shared/chatStrings'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'

export interface LimitActions {
  continueIn(to: AgentKind, message: string | null): void
  /** Keep the stopped message queued and send it at the reset. */
  sendAt(text: string, at: number): void
  notifyAt(at: number): void
}

export interface LimitCardInput {
  agentName: string
  otherAgent: AgentKind
  otherName: string
  situation: LimitSituation
  now: number
  /** The stopped message is already queued for the reset. */
  scheduled: boolean
  /** A reminder is already set for the reset. */
  reminded: boolean
  actions: LimitActions
}

function button(label: string, onClick: () => void, primary: boolean, disabled = false): HTMLElement {
  return h('button', { class: `chat-btn${primary ? ' primary' : ''}`, type: 'button', disabled, onClick }, label)
}

function buttons(input: LimitCardInput): HTMLElement[] {
  const { situation, actions } = input
  const out = [button(CHAT_TEXT.continueIn(input.otherName), () => actions.continueIn(input.otherAgent, situation.pendingText), true)]
  const at = situation.resetsAt
  if (!resetsLater(at, input.now)) return out
  if (situation.pendingText !== null && !input.scheduled) out.push(button(sendAtLabel(at), () => actions.sendAt(situation.pendingText ?? '', at), false))
  out.push(input.reminded ? button('Reminder set', () => undefined, false, true) : button(notifyAtLabel(at), () => actions.notifyAt(at), false))
  return out
}

/** The card for a usage limit that stops the session: what happened, when it ends, and the three things to do about it. */
export function limitCard(input: LimitCardInput): HTMLElement {
  const stopped = input.situation.pendingText !== null
  return h(
    'div',
    { class: 'chat-notice chat-limit', role: 'status' },
    h('b', { dir: 'auto' }, limitTitle(input.agentName)),
    h('span', { class: 'chat-quiet' }, resetLine(input.situation.resetsAt, input.now, stopped && !input.scheduled)),
    h('div', { class: 'chat-acts' }, ...buttons(input))
  )
}
