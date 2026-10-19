import { DICTATION_LANGUAGES, DICTATION_MODELS, DICTATION_SHORTCUT } from '../../shared/dictation'
import { setDictation } from '../dictation/dictationIntro'
import { h } from '../dom'
import type { AppState } from '../state'
import { selectMenu, syncSelectMenu } from './selectMenu'

function row(title: string, control: HTMLElement, ...notes: HTMLElement[]): HTMLElement {
  return h('div', { class: 'set-row' }, h('div', { class: 'set-main' }, h('div', { class: 'set-name' }, title), ...notes), h('div', { class: 'set-control' }, control))
}

function choice<T extends string>(id: string, label: string, options: { id: T; label: string }[], value: T, onChange: (value: T) => void): HTMLElement {
  const select = h('select', { class: 'field-select', id, 'aria-label': label })
  for (const option of options) select.append(h('option', { value: option.id }, option.label))
  select.value = value
  select.addEventListener('change', () => onChange(select.value as T))
  return selectMenu(select)
}

/** Lists the microphones once the system names them; until then only the default is offered. */
function microphoneChoice(current: string): HTMLElement {
  const select = h('select', { class: 'field-select', id: 'dictation-microphone', 'aria-label': 'Microphone' })
  select.append(h('option', { value: '' }, 'System default'))
  if (current) select.append(h('option', { value: current }, 'Chosen microphone (not connected)'))
  select.value = current
  select.addEventListener('change', () => setDictation({ microphone: select.value }))
  const wrapped = selectMenu(select)
  void navigator.mediaDevices?.enumerateDevices().then((devices) => {
    const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    if (inputs.length === 0) return
    select.replaceChildren(h('option', { value: '' }, 'System default'), ...inputs.map((d, i) => h('option', { value: d.deviceId }, d.label || `Microphone ${i + 1}`)))
    if (current && !inputs.some((d) => d.deviceId === current)) select.append(h('option', { value: current }, 'Chosen microphone (not connected)'))
    select.value = current
    syncSelectMenu(select)
  }).catch(() => undefined)
  return wrapped
}

export function dictationRows(state: AppState): HTMLElement[] {
  const settings = state.settings.dictation
  return [
    row(
      'Spoken language',
      choice('dictation-language', 'Dictation language', DICTATION_LANGUAGES, settings.language, (language) => setDictation({ language })),
      h('p', { class: 'hint' }, `Press ${DICTATION_SHORTCUT} (or the mic button in a pane) to dictate into the focused session or text box. Auto-detect handles Arabic and English; pick one if it guesses wrong.`)
    ),
    row(
      'Speech model',
      choice('dictation-model', 'Dictation model', DICTATION_MODELS.map((m) => ({ id: m.id, label: m.label })), settings.model, (model) => setDictation({ model })),
      h('p', { class: 'hint', id: 'dictation-model-note' }, `Runs on this PC with Whisper, so your voice never leaves it. The model downloads once on first use (${DICTATION_MODELS.find((m) => m.id === settings.model)?.size ?? ''}) and is kept in Dawsha's data folder, so dictation then works offline. Large turbo understands Arabic dialects and mixed Arabic and English best; choose Base on a slower PC without a graphics card.`)
    ),
    row(
      'Microphone',
      microphoneChoice(settings.microphone),
      h('p', { class: 'hint' }, 'If dictation says the microphone sent only silence, check its mute switch or pick another one here.')
    )
  ]
}
