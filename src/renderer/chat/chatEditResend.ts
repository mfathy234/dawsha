import { textDirection } from '../../shared/chatLog'
import { REWIND_TEXT } from '../../shared/rewindStrings'
import { h } from '../dom'
import './chatRewind.css'

export interface EditBoxOptions {
  messageId: string
  text: string
  /** The files the send would put back; hovering the footer lists them. */
  paths: readonly string[]
  cancel(): void
  send(text: string): void
}

/** The bubble turned into a text box in place. One element lives for the whole edit, so a redraw of the thread never loses the typing. */
export class EditBox {
  readonly el: HTMLElement
  private readonly input: HTMLTextAreaElement
  private readonly foot: HTMLElement
  private readonly sendButton: HTMLButtonElement

  constructor(private readonly options: EditBoxOptions) {
    this.input = h('textarea', { class: 'chat-edit-input', rows: 1, 'aria-label': REWIND_TEXT.editLabel, dir: textDirection(options.text), spellcheck: 'false' })
    this.input.value = options.text
    this.foot = h('span', { class: 'chat-edit-note', title: options.paths.join('\n') }, REWIND_TEXT.editFoot(options.paths.length))
    this.sendButton = h('button', { class: 'btn sm primary', type: 'button', onClick: () => this.submit() }, REWIND_TEXT.send)
    this.el = h('div', { class: 'chat-edit', 'data-msg-id': options.messageId, role: 'group', 'aria-label': REWIND_TEXT.editLabel },
      this.input,
      h('div', { class: 'chat-edit-foot' }, this.foot, h('button', { class: 'btn sm', type: 'button', onClick: () => options.cancel() }, REWIND_TEXT.cancel), this.sendButton))
    this.input.addEventListener('input', () => { this.grow(); this.sendButton.disabled = this.input.value.trim() === '' })
    this.input.addEventListener('keydown', (event) => this.onKey(event))
  }

  get value(): string {
    return this.input.value
  }

  /** Called after the box is in the page: sizes it and, unless the user has gone elsewhere, puts the caret back. */
  settle(grab: boolean): void {
    this.grow()
    const free = !document.activeElement || document.activeElement === document.body
    if (grab || (free && this.el.isConnected)) this.input.focus({ preventScroll: !grab })
    if (grab) this.input.setSelectionRange(this.input.value.length, this.input.value.length)
  }

  /** While the files are being put back, Send waits. */
  setBusy(busy: boolean): void {
    this.sendButton.disabled = busy || this.input.value.trim() === ''
    this.el.setAttribute('aria-busy', String(busy))
  }

  private grow(): void {
    this.input.style.height = 'auto'
    this.input.style.height = `${Math.min(this.input.scrollHeight, 240)}px`
  }

  private submit(): void {
    const text = this.input.value.trim()
    if (text !== '' && !this.sendButton.disabled) this.options.send(text)
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.options.cancel()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault()
      this.submit()
    }
  }
}
