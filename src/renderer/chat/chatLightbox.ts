import type { ChatImageAction, ChatImageRef } from '../../shared/chatImage'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { api } from '../api'
import { toast } from '../components/toast'
import { h } from '../dom'
import { fetchImage, type ChatSessionRef } from './chatImageCache'

let current: { close: () => void } | null = null

const DONE: Readonly<Record<ChatImageAction, string>> = { copy: CHAT_TEXT.imageCopied, open: '', reveal: '' }

async function act(session: ChatSessionRef, ref: ChatImageRef, action: ChatImageAction): Promise<void> {
  try {
    const result = await api.chat.imageAction({ agent: session.agent, sessionId: session.sessionId, imageId: ref.id, action })
    if (!result.ok) toast(CHAT_TEXT.imageActionFailed, 'error')
    else if (DONE[action]) toast(DONE[action], 'info')
  } catch {
    toast(CHAT_TEXT.imageActionFailed, 'error')
  }
}

/** The picture large, over the window. Esc or a click outside closes it. Arrow keys step through the pictures of the message. */
export function openLightbox(refs: readonly ChatImageRef[], start: number, session: ChatSessionRef): void {
  current?.close()
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  let index = Math.max(0, start)
  const stage = h('div', { class: 'chat-lightbox-stage' })
  const caption = h('span', { class: 'chat-lightbox-caption', dir: 'auto' })
  const button = (label: string, run: () => void): HTMLButtonElement => h('button', { class: 'chat-btn', type: 'button', onClick: run }, label)
  const bar = h(
    'div',
    { class: 'chat-lightbox-bar' },
    caption,
    button(CHAT_TEXT.imageCopy, () => void act(session, refs[index], 'copy')),
    button(CHAT_TEXT.imageOpenExternal, () => void act(session, refs[index], 'open')),
    button(CHAT_TEXT.imageReveal, () => void act(session, refs[index], 'reveal')),
    button(CHAT_TEXT.close, () => close())
  )
  const overlay = h('div', { class: 'chat-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': CHAT_TEXT.imageAlt, tabindex: '-1' }, stage, bar)

  const show = async (): Promise<void> => {
    const ref = refs[index]
    caption.textContent = `${ref.label ?? CHAT_TEXT.imageAlt}${refs.length > 1 ? ` (${index + 1}/${refs.length})` : ''}`
    stage.replaceChildren(h('span', { class: 'chat-quiet' }, CHAT_TEXT.imageLoading))
    const result = await fetchImage(session, ref.id)
    if (refs[index] !== ref || !overlay.isConnected) return
    stage.replaceChildren(
      result.status === 'ok'
        ? h('img', { class: 'chat-lightbox-img', src: result.dataUrl, alt: ref.label ?? CHAT_TEXT.imageAlt, draggable: false })
        : h('span', { class: 'chat-quiet' }, result.status === 'too-large' ? CHAT_TEXT.imageTooLarge : result.status === 'blocked' ? CHAT_TEXT.imageBlocked : CHAT_TEXT.imageMissing)
    )
  }
  const step = (by: number): void => {
    index = (index + by + refs.length) % refs.length
    void show()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (refs.length > 1 && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      step(event.key === 'ArrowRight' ? 1 : -1)
    }
  }
  function close(): void {
    document.removeEventListener('keydown', onKey, true)
    overlay.remove()
    if (current?.close === close) current = null
    opener?.focus()
  }
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay || event.target === stage) close()
  })
  document.addEventListener('keydown', onKey, true)
  document.body.append(overlay)
  current = { close }
  overlay.focus()
  void show()
}
