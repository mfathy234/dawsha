import type { ChatView } from '../../shared/chatLog'
import { h } from '../dom'

const LABELS: Record<ChatView, string> = { terminal: 'Terminal', chat: 'Chat' }

/** The Terminal and Chat buttons of a pane header, or of Settings and New session. Shown only for agents with a chat view. */
export class ViewSwitch {
  readonly el: HTMLElement
  private readonly buttons: Record<ChatView, HTMLButtonElement>
  private pick: (view: ChatView) => void = () => undefined

  constructor(label: string, extraClass = '') {
    const button = (view: ChatView): HTMLButtonElement =>
      h('button', { type: 'button', 'data-view': view, 'aria-pressed': 'false', onClick: () => this.pick(view) }, LABELS[view])
    this.buttons = { terminal: button('terminal'), chat: button('chat') }
    this.el = h('span', { class: `chat-seg ${extraClass}`.trim(), role: 'group', 'aria-label': label }, this.buttons.terminal, this.buttons.chat)
  }

  update(view: ChatView | null, pick: (view: ChatView) => void): void {
    this.pick = pick
    this.el.hidden = view === null
    for (const [name, button] of Object.entries(this.buttons)) button.setAttribute('aria-pressed', String(name === view))
  }
}
