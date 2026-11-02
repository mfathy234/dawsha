import type { ChatImageRef, ChatImageResult } from '../../shared/chatImage'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { h } from '../dom'
import { cachedImage, fetchImage, type ChatSessionRef } from './chatImageCache'
import { openLightbox } from './chatLightbox'

const loaders = new WeakMap<Element, () => void>()
let observer: IntersectionObserver | null = null

/** One observer for every thumbnail: a picture is fetched when it first scrolls near the screen, not before. */
function watch(element: Element, load: () => void): void {
  if (typeof IntersectionObserver === 'undefined') return load()
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer?.unobserve(entry.target)
        loaders.get(entry.target)?.()
      }
    },
    { rootMargin: '200px' }
  )
  loaders.set(element, load)
  observer.observe(element)
}

const noteFor = (result: ChatImageResult): string => (result.status === 'too-large' ? CHAT_TEXT.imageTooLarge : result.status === 'blocked' ? CHAT_TEXT.imageBlocked : CHAT_TEXT.imageMissing)

function fill(button: HTMLElement, ref: ChatImageRef, result: ChatImageResult): void {
  if (result.status === 'ok') {
    const img = h('img', { class: 'chat-thumb-img', src: result.dataUrl, alt: ref.label ?? CHAT_TEXT.imageAlt, draggable: false })
    button.replaceChildren(img)
    button.classList.remove('empty')
    return
  }
  button.classList.add('empty')
  button.replaceChildren(h('span', { class: 'chat-quiet' }, noteFor(result)))
}

function thumb(ref: ChatImageRef, session: ChatSessionRef, all: readonly ChatImageRef[]): HTMLElement {
  const button = h(
    'button',
    { class: 'chat-thumb', type: 'button', 'data-image': ref.id, title: ref.label ?? CHAT_TEXT.imageAlt, 'aria-label': `${CHAT_TEXT.imageOpen}${ref.label ? `: ${ref.label}` : ''}`, onClick: () => openLightbox(all, all.indexOf(ref), session) },
    h('span', { class: 'chat-thumb-wait', 'aria-hidden': 'true' })
  )
  if (ref.width && ref.height) button.style.aspectRatio = `${ref.width} / ${ref.height}`
  const known = cachedImage(session, ref.id)
  if (known) fill(button, ref, known)
  else watch(button, () => void fetchImage(session, ref.id).then((result) => fill(button, ref, result)))
  return button
}

/** A row of small pictures; a click opens the larger view. */
export function imageStrip(refs: readonly ChatImageRef[] | undefined, session: ChatSessionRef | null): HTMLElement | null {
  if (!refs || refs.length === 0 || !session) return null
  return h('div', { class: 'chat-thumbs', dir: 'ltr' }, ...refs.map((ref) => thumb(ref, session, refs)))
}
