import { h } from '../dom'

export interface ChatPopover {
  el: HTMLElement
  close(): void
}

const FOCUSABLE = 'button:not([disabled])'
const GAP_PX = 6
const EDGE_PX = 8

let current: { anchor: HTMLElement; close: () => void } | null = null

/** Closes whichever composer popover is open. */
export const closeChatPopover = (): void => current?.close()

/**
 * Opens a small menu above its anchor (the composer sits at the bottom). A second click on the anchor, Escape and a click
 * elsewhere close it, and focus goes back to the anchor. Arrow keys move between its buttons.
 */
export function openChatPopover(anchor: HTMLElement, label: string, content: readonly Node[], align: 'left' | 'right', onClose?: () => void): ChatPopover | null {
  const same = current?.anchor === anchor
  closeChatPopover()
  if (same) return null
  const el = h('div', { class: 'popover chat-pop', role: 'dialog', 'aria-label': label }, ...content)
  document.body.append(el)
  const rect = anchor.getBoundingClientRect()
  el.style.position = 'fixed'
  const left = align === 'left' ? rect.left : rect.right - el.offsetWidth
  el.style.left = `${Math.max(EDGE_PX, Math.min(left, innerWidth - el.offsetWidth - EDGE_PX))}px`
  el.style.top = `${Math.max(EDGE_PX, rect.top - el.offsetHeight - GAP_PX)}px`
  anchor.setAttribute('aria-expanded', 'true')
  const outside = (event: PointerEvent): void => {
    if (!el.contains(event.target as Node) && !anchor.contains(event.target as Node)) close()
  }
  const keys = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next].focus()
  }
  function close(): void {
    if (current?.close !== close) return
    current = null
    el.remove()
    anchor.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', keys, true)
    onClose?.()
    anchor.focus()
  }
  current = { anchor, close }
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', keys, true)
  const first = el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>(FOCUSABLE)
  first?.focus()
  return { el, close }
}
