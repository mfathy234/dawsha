import { h, iconButton } from '../dom'
import { ICONS } from '../icons'

const ERROR_DURATION_MS = 7000
const INFO_DURATION_MS = 4000
const ACTION_DURATION_MS = 8000
const MAX_TOASTS = 3

export interface ToastAction {
  label: string
  run: () => void
}

let region: HTMLElement | null = null

function ensureRegion(): HTMLElement {
  if (region) return region
  region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })
  document.body.appendChild(region)
  return region
}

export function toast(message: string, kind: 'error' | 'info' = 'error', action?: ToastAction): void {
  const item = h('div', { class: `toast ${kind}` }, h('span', { class: 'toast-text' }, message))
  const dismiss = (): void => item.remove()
  item.addEventListener('click', dismiss)
  if (action) {
    // The button runs first, then the click bubbles up and closes the toast.
    item.append(h('button', { class: 'btn small toast-action', type: 'button', onClick: () => action.run() }, action.label))
  }
  item.append(iconButton('Dismiss notification', ICONS.closeSmall, dismiss, 'small toast-x'))
  const stack = ensureRegion()
  stack.appendChild(item)
  while (stack.childElementCount > MAX_TOASTS) stack.firstElementChild?.remove()
  // A toast stays while the pointer is on it, so a Reopen or an error can be read before it goes.
  const duration = action ? ACTION_DURATION_MS : kind === 'info' ? INFO_DURATION_MS : ERROR_DURATION_MS
  let timer = setTimeout(dismiss, duration)
  item.addEventListener('pointerenter', () => clearTimeout(timer))
  item.addEventListener('pointerleave', () => {
    clearTimeout(timer)
    timer = setTimeout(dismiss, INFO_DURATION_MS)
  })
}
