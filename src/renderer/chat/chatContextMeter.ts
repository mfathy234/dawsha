import { CLEAR_SLASH, COMPACT_SLASH, clearConfirm, contextHeading, contextNoteText, contextWarn, stepContextNote, type ContextReading, type NoteMemory } from '../../shared/chatContext'
import { confirmDialog } from '../components/dialogs'
import { h } from '../dom'
import { closeChatPopover, openChatPopover } from './chatPopover'

export interface ContextHost {
  /** Types a slash command into the agent. */
  command(text: string): void
}

/** The small grey bar and percentage in the chat box; a click opens the numbers and the two things to do about them. */
export class ContextMeter {
  readonly el = h('button', { class: 'chat-ctx', type: 'button', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' })
  private readonly fill = h('i')
  private readonly percent = h('span', { class: 'chat-ctx-pct' })
  private reading: ContextReading | null = null
  private session = { name: '' }

  constructor(private readonly host: ContextHost) {
    this.el.append(h('span', { class: 'chat-ctx-bar', 'aria-hidden': 'true' }, this.fill), this.percent)
    this.el.addEventListener('click', () => this.open())
  }

  update(reading: ContextReading | null, sessionName: string): void {
    this.reading = reading
    this.session = { name: sessionName }
    this.el.hidden = reading === null
    if (!reading) return
    const warn = contextWarn(reading)
    this.fill.style.width = `${reading.percent}%`
    this.percent.textContent = `${reading.percent}%`
    this.el.classList.toggle('warn', warn)
    this.el.setAttribute('aria-label', `Context ${reading.percent}% full${warn ? ', nearly full' : ''}. Show details`)
    this.el.title = contextHeading(reading)
  }

  private open(): void {
    const reading = this.reading
    if (!reading) return
    const name = this.session.name
    const act = (run: () => void) => () => {
      closeChatPopover()
      run()
    }
    const compact = this.item('Compact now', COMPACT_SLASH, act(() => this.host.command(COMPACT_SLASH)))
    const clear = this.item('Clear and start fresh', CLEAR_SLASH, act(() => void this.confirmClear(name)))
    openChatPopover(this.el, 'Context', [h('div', { class: 'chat-pop-head' }, contextHeading(reading)), compact, clear], 'right')
  }

  private item(label: string, command: string, onClick: () => void): HTMLElement {
    return h('button', { class: 'chat-pop-item', type: 'button', onClick }, h('span', {}, label), h('span', { class: 'chat-pop-quiet', dir: 'ltr' }, command))
  }

  private async confirmClear(name: string): Promise<void> {
    const confirm = clearConfirm(name || 'this session')
    if (await confirmDialog({ ...confirm, danger: true })) this.host.command(CLEAR_SLASH)
  }
}

/** The one note above the chat box, near the top of the window. */
export class ContextNote {
  readonly el = h('div', { class: 'chat-ctx-note', role: 'status', hidden: true })
  private memory: NoteMemory = { dismissed: false }
  private key = ''

  constructor(private readonly host: ContextHost) {}

  update(reading: ContextReading | null, agentName: string, sessionKey: string): void {
    if (sessionKey !== this.key) {
      this.key = sessionKey
      this.memory = { dismissed: false }
    }
    const step = stepContextNote(this.memory, reading?.percent ?? null)
    this.memory = step.memory
    this.el.hidden = !step.show
    if (!step.show || !reading) return
    const text = contextNoteText(reading.percent, agentName)
    if (this.el.dataset.text === `${text.lead}${text.rest}`) return
    this.el.dataset.text = `${text.lead}${text.rest}`
    this.el.replaceChildren(
      h('span', { class: 'chat-ctx-note-text' }, h('b', {}, text.lead), ' ', text.rest),
      h('button', { class: 'chat-btn', type: 'button', onClick: () => this.hide() }, 'Not now'),
      h('button', { class: 'chat-btn primary', type: 'button', onClick: () => this.compact() }, 'Compact')
    )
  }

  private hide(): void {
    this.memory = { dismissed: true }
    this.el.hidden = true
  }

  private compact(): void {
    this.hide()
    this.host.command(COMPACT_SLASH)
  }
}
