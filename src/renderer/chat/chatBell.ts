import { CHAT_TEXT } from '../../shared/chatStrings'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import './chatExtras.css'

export interface BellView {
  /** The user message whose turn is running right now. */
  messageId: string | null
  watched: ReadonlySet<string>
  toggle(id: string): void
}

/** The small bell on a user message whose turn is still running (or that is being watched). Null when there is nothing to watch. */
export function bellButton(id: string, bell: BellView | undefined): HTMLElement | null {
  if (!bell) return null
  const on = bell.watched.has(id)
  if (!on && bell.messageId !== id) return null
  const label = on ? CHAT_TEXT.bellOn : CHAT_TEXT.bellOff
  return h(
    'button',
    {
      class: `chat-bell${on ? ' on' : ''}`,
      type: 'button',
      title: label,
      'aria-label': label,
      'aria-pressed': String(on),
      'data-bell': id,
      onClick: (event: Event) => {
        event.stopPropagation()
        bell.toggle(id)
      }
    },
    icon(ICONS.bell)
  )
}
