import { AGENTS, agentLabel } from '../../shared/agents'
import { REWIND_TEXT } from '../../shared/rewindStrings'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'
import '../chat/chatRewind.css'

export interface TryAgainOptions {
  agent: AgentKind
  message: string
  /** "10:42", or null when the message has no time. */
  time: string | null
  /** The number of the attempt this starts. */
  number: number
  canBringConversation: boolean
}

export interface TryAgainChoice {
  agent: AgentKind
  message: string
  bring: boolean
}

/** Agent tabs, the message to send, and whether to bring the conversation. Resolves with the choice, or null on cancel. */
export function tryAgainDialog(options: TryAgainOptions): Promise<TryAgainChoice | null> {
  const id = nextDialogId()
  let agent = options.agent
  const tabs = AGENTS.map((kind) => h('button', { class: 'try-tab', type: 'button', role: 'tab', 'data-agent': kind }, agentLabel(kind)))
  const paint = (): void => tabs.forEach((tab) => { const on = tab.dataset.agent === agent; tab.classList.toggle('on', on); tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1 })
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => { agent = AGENTS[index]; paint() })
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      event.preventDefault()
      const next = (index + step + AGENTS.length) % AGENTS.length
      agent = AGENTS[next]
      paint()
      tabs[next].focus()
    })
  })
  const area = h('textarea', { class: 'text-input dialog-text', id: `try-msg-${id}`, rows: '4', spellcheck: 'false' })
  area.value = options.message
  const bring = h('input', { type: 'checkbox', id: `try-bring-${id}`, checked: options.canBringConversation, disabled: !options.canBringConversation })
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, REWIND_TEXT.cancel)
  const start = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, REWIND_TEXT.tryStart(options.number))
  const dialog = h('div', { class: 'dialog try-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': REWIND_TEXT.tryTitle(options.message) },
    h('h2', {}, REWIND_TEXT.tryTitle(options.message)),
    h('p', {}, REWIND_TEXT.tryBody(options.time)),
    h('div', { class: 'try-tabs', role: 'tablist', 'aria-label': REWIND_TEXT.tryAgentLabel }, ...tabs),
    h('div', { class: 'field' }, h('label', { for: `try-msg-${id}`, class: 'dialog-label' }, REWIND_TEXT.tryMessage), area),
    h('label', { class: 'try-opt', for: `try-bring-${id}` }, bring, REWIND_TEXT.tryBring),
    error,
    h('div', { class: 'dialog-actions' }, cancel, start))
  paint()
  const shown = present<TryAgainChoice | null>(dialog, null, area)
  area.addEventListener('input', () => { error.hidden = true })
  cancel.addEventListener('click', () => shown.finish(null))
  start.addEventListener('click', () => {
    const message = area.value.trim()
    if (message === '') {
      error.textContent = REWIND_TEXT.tryEmpty
      error.hidden = false
      return
    }
    shown.finish({ agent, message, bring: bring.checked && options.canBringConversation })
  })
  return shown.result
}
