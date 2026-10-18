import { h } from '../dom'
import { dictationIndicator } from './dictationIndicator'
import { onDictationStatus } from './dictationState'

/** A small floating status for dictation into a text box, which may sit in a dialog with no pane in view. */
export function installDictationPill(): void {
  const indicator = dictationIndicator()
  const pill = h('div', { class: 'dictation-pill', role: 'status', hidden: true }, indicator.meter, indicator.text)
  document.body.appendChild(pill)
  onDictationStatus((status) => {
    const show = status.phase !== 'idle' && status.intoField
    pill.hidden = !show
    pill.classList.toggle('recording', show && status.phase === 'recording')
    indicator.update(show ? status : { ...status, phase: 'idle' })
  })
}
