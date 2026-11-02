import { CHAT_TEXT } from '../../shared/chatStrings'
import { api } from '../api'
import { toast } from '../components/toast'
import { h, icon } from '../dom'
import { ICONS } from '../icons'

/** A small button that puts text on the clipboard. The text is read when it is clicked, so it is always what is on screen. */
export function copyButton(text: () => string, label: string = CHAT_TEXT.copy): HTMLElement {
  const button = h('button', { class: 'chat-copy', type: 'button', title: label, 'aria-label': label }, icon(ICONS.copy))
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    api.writeClipboard(text()).then(
      () => {
        button.classList.add('copied')
        button.title = CHAT_TEXT.copied
        window.setTimeout(() => {
          button.classList.remove('copied')
          button.title = label
        }, 1200)
      },
      () => toast(CHAT_TEXT.copyFailed, 'error')
    )
  })
  return button
}
