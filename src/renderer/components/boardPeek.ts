import { closePeek, peekInGrid, sendReply } from '../boardActions'
import type { PaneView } from '../derive'
import { h, iconButton } from '../dom'
import { ICONS } from '../icons'
import { agentLabel } from '../../shared/agents'
import { ensureTerminal, getTerminal } from '../terminals'
import { agentMark } from './agentMark'

/** The board's right-hand panel: the pane's live terminal (the same instance the grid uses) and a reply box. */
export class BoardPeek {
  readonly el = h('aside', { class: 'board-peek', hidden: true })
  private readonly mark = h('span', { class: 'board-peek-mark' })
  private readonly title = h('b', { class: 'board-peek-title', dir: 'auto' })
  private readonly term = h('div', { class: 'board-peek-term' })
  private readonly input = h('input', { class: 'text-input board-peek-input', type: 'text', autocomplete: 'off', spellcheck: 'false' })
  private readonly send = h('button', { class: 'btn primary', type: 'submit' }, 'Send')
  private readonly gridButton = h('button', { class: 'btn small', type: 'button' }, 'Open in grid')
  private paneId: string | null = null
  private termId: string | null = null

  constructor() {
    const form = h('form', { class: 'board-peek-reply', 'aria-label': 'Reply' }, this.input, this.send)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (this.paneId && sendReply(this.paneId, this.input.value)) this.input.value = ''
    })
    this.gridButton.addEventListener('click', () => this.paneId && peekInGrid(this.paneId))
    const head = h('div', { class: 'board-peek-head' }, this.mark, this.title, h('span', { class: 'board-spacer' }), this.gridButton, iconButton('Close peek', ICONS.close, () => closePeek(), 'small'))
    this.el.append(head, this.term, form)
  }

  update(view: PaneView | null): void {
    if (!view) return this.hide()
    const opened = this.paneId !== view.pane.id
    this.el.hidden = false
    this.el.setAttribute('aria-label', `Peek: ${view.title}`)
    if (this.title.textContent !== view.title) this.title.textContent = view.title
    if (opened || this.termId !== view.primaryTabId) this.show(view, opened)
    const agent = view.agent === 'shell' ? 'the terminal' : agentLabel(view.agent)
    this.input.placeholder = `Reply to ${agent}…`
    this.input.setAttribute('aria-label', `Message to ${agent}`)
  }

  private show(view: PaneView, opened: boolean): void {
    this.release()
    this.paneId = view.pane.id
    this.termId = view.primaryTabId
    this.mark.replaceChildren(...[agentMark(view.agent)].filter((node): node is HTMLElement => node !== null))
    ensureTerminal(view.primaryTabId, view.pane.fontSize).lendTo(this.term)
    if (opened) this.input.focus()
  }

  private release(): void {
    if (this.termId) getTerminal(this.termId)?.returnLoan()
    this.termId = null
  }

  private hide(): void {
    this.release()
    this.paneId = null
    this.el.hidden = true
  }
}
