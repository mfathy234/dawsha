import { h } from '../dom'
import { onDictationStatus, statusText } from './dictationState'

/** A small floating status for dictation into a text box, which may sit in a dialog with no pane in view. */
export function installDictationPill(): void {
  const pill = h('div', { class: 'dictation-pill', role: 'status', hidden: true })
  document.body.appendChild(pill)
  onDictationStatus((status) => {
    const show = status.phase !== 'idle' && status.intoField
    pill.hidden = !show
    pill.classList.toggle('recording', show && status.phase === 'recording')
    pill.textContent = show ? statusText(status) : ''
  })
}
