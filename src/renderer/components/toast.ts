import { h } from '../dom'

const ERROR_DURATION_MS = 7000
const INFO_DURATION_MS = 4000
const MAX_TOASTS = 3

let region: HTMLElement | null = null

function ensureRegion(): HTMLElement {
  if (region) return region
  region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })
  document.body.appendChild(region)
  return region
}

export function toast(message: string, kind: 'error' | 'info' = 'error'): void {
  const item = h('div', { class: `toast ${kind}` }, message)
  const dismiss = (): void => item.remove()
  item.addEventListener('click', dismiss)
  const stack = ensureRegion()
  stack.appendChild(item)
  while (stack.childElementCount > MAX_TOASTS) stack.firstElementChild?.remove()
  setTimeout(dismiss, kind === 'info' ? INFO_DURATION_MS : ERROR_DURATION_MS)
}
