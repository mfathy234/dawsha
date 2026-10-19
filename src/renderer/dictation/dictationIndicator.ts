import { h } from '../dom'
import { statusText, type DictationStatus } from './dictationState'

export interface DictationIndicator {
  readonly text: HTMLElement
  readonly meter: HTMLElement
  update(status: DictationStatus): void
}

/** The status line of a dictation, with a live level meter while listening. Built once, updated in place. */
export function dictationIndicator(): DictationIndicator {
  const fill = h('span', { class: 'dictation-meter-fill' })
  const meter = h('span', { class: 'dictation-meter', role: 'meter', 'aria-label': 'Microphone level', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill)
  const text = h('span', { class: 'dictation-text' })
  return {
    text,
    meter,
    update(status) {
      const listening = status.phase === 'recording'
      meter.hidden = !listening
      meter.classList.toggle('quiet', status.quiet)
      meter.setAttribute('aria-valuenow', String(Math.round(status.level * 100)))
      fill.style.transform = `scaleX(${listening ? status.level : 0})`
      const next = status.phase === 'idle' ? '' : statusText(status)
      if (text.textContent !== next) text.textContent = next
    }
  }
}
