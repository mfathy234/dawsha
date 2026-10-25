import { iconButton } from '../dom'
import { ICONS } from '../icons'

// The corner X for palettes and popovers. Labelled Dismiss (not Close) so it never collides with a popup's own Close button.
// It runs the same close function as Esc and click-outside, and keeps keyboard focus where it was.
export function popupDismissButton(dismiss: () => void, extraClass = ''): HTMLButtonElement {
  const button = iconButton('Dismiss', ICONS.close, dismiss, `small popup-x ${extraClass}`.trim())
  button.addEventListener('mousedown', (event) => event.preventDefault())
  return button
}
