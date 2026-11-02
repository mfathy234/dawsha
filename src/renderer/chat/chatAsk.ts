import type { AskPrompt, AskQuestion } from '../../shared/chatAsk'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { isAnswered, type AskAnswer } from '../../shared/menuAnswer'
import { h } from '../dom'

export interface AskActions {
  send(answers: AskAnswer[]): void
  showTerminal(): void
}

const EMPTY: AskAnswer = { numbers: [], other: '' }

/** One question picker as a card of clickable choices. It keeps what was chosen, so the thread can redraw around it. */
export class AskCard {
  readonly el = h('div', { class: 'chat-ask', role: 'group' })
  private answers: AskAnswer[]
  private sent = false
  private readonly immediate: boolean

  constructor(private readonly prompt: AskPrompt, agentName: string, private readonly actions: AskActions) {
    this.answers = prompt.questions.map(() => EMPTY)
    this.immediate = prompt.questions.length === 1 && !prompt.questions[0].multiSelect
    this.el.setAttribute('aria-label', `${agentName}: ${prompt.questions[0]?.question ?? ''}`)
    this.draw()
  }

  private set(index: number, answer: AskAnswer): void {
    this.answers = this.answers.map((current, at) => (at === index ? answer : current))
  }

  private pick(index: number, question: AskQuestion, number: number): void {
    const current = this.answers[index]
    const numbers = !question.multiSelect ? [number] : current.numbers.includes(number) ? current.numbers.filter((n) => n !== number) : [...current.numbers, number]
    this.set(index, { numbers, other: question.multiSelect ? current.other : '' })
    if (this.immediate) this.submit()
    else this.draw()
  }

  private submit(): void {
    if (this.sent || !isAnswered(this.prompt.questions, this.answers)) return
    this.sent = true
    this.actions.send(this.answers)
    this.draw()
  }

  private option(index: number, question: AskQuestion, number: number, label: string, description: string): HTMLElement {
    const chosen = this.answers[index].numbers.includes(number) && this.answers[index].other === ''
    return h(
      'button',
      { class: `chat-opt${chosen ? ' on' : ''}`, type: 'button', 'aria-pressed': String(chosen), disabled: this.sent, onClick: () => this.pick(index, question, number) },
      h('span', { class: 'chat-opt-n', 'aria-hidden': 'true' }, String(number)),
      h('span', { class: 'chat-opt-text', dir: 'auto' }, h('b', {}, label), description ? h('span', { class: 'chat-quiet' }, description) : null)
    )
  }

  private otherRow(index: number, question: AskQuestion): HTMLElement | null {
    if (question.otherNumber === null) return null
    const input = h('input', { class: 'chat-opt-other', type: 'text', dir: 'auto', placeholder: CHAT_TEXT.askOtherPlaceholder, 'aria-label': CHAT_TEXT.askOther, value: this.answers[index].other, disabled: this.sent })
    input.addEventListener('input', () => {
      this.set(index, { numbers: [], other: input.value })
      if (!this.immediate) this.refreshSend()
    })
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      this.submit()
    })
    return h('div', { class: 'chat-opt-row' }, input, this.immediate ? this.sendButton(CHAT_TEXT.askSendOne) : null)
  }

  private sendButton(label: string): HTMLElement {
    return h('button', { class: 'chat-btn primary chat-ask-send', type: 'button', disabled: this.sent || !isAnswered(this.prompt.questions, this.answers), onClick: () => this.submit() }, label)
  }

  private refreshSend(): void {
    const button = this.el.querySelector<HTMLButtonElement>('.chat-ask-footer .chat-ask-send')
    if (button) button.disabled = this.sent || !isAnswered(this.prompt.questions, this.answers)
  }

  private block(index: number, question: AskQuestion): HTMLElement {
    return h(
      'div',
      { class: 'chat-ask-q' },
      question.header ? h('span', { class: 'chat-chip' }, question.header) : null,
      h('b', { class: 'chat-ask-title', dir: 'auto' }, question.question),
      question.multiSelect ? h('span', { class: 'chat-quiet' }, CHAT_TEXT.askMany) : null,
      ...question.options.map((option) => this.option(index, question, option.number, option.label, option.description)),
      this.otherRow(index, question)
    )
  }

  private draw(): void {
    const footer = h(
      'div',
      { class: 'chat-acts chat-ask-footer' },
      this.sent ? h('span', { class: 'chat-quiet', role: 'status' }, CHAT_TEXT.askSent) : this.immediate ? null : this.sendButton(CHAT_TEXT.askSend),
      h('button', { class: 'chat-more', type: 'button', onClick: () => this.actions.showTerminal() }, CHAT_TEXT.askOrTerminal)
    )
    this.el.replaceChildren(...this.prompt.questions.map((question, index) => this.block(index, question)), footer)
  }
}
