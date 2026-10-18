import {
  DICTATION_LANGUAGES,
  DICTATION_MODELS,
  DICTATION_SHORTCUT,
  sanitizeDictation,
  type DictationSettings
} from '../../shared/dictation'
import { saveSettings } from '../actions'
import { h } from '../dom'
import { store, type AppState } from '../state'
import { selectMenu } from './selectMenu'

function row(title: string, control: HTMLElement, ...notes: HTMLElement[]): HTMLElement {
  return h('div', { class: 'set-row' }, h('div', { class: 'set-main' }, h('div', { class: 'set-name' }, title), ...notes), h('div', { class: 'set-control' }, control))
}

function setDictation(change: Partial<DictationSettings>): void {
  const dictation = sanitizeDictation({ ...store.state.settings.dictation, ...change })
  store.set((s) => ({ ...s, settings: { ...s.settings, dictation } }))
  void saveSettings({ dictation })
}

function choice<T extends string>(id: string, label: string, options: { id: T; label: string }[], value: T, onChange: (value: T) => void): HTMLElement {
  const select = h('select', { class: 'field-select', id, 'aria-label': label })
  for (const option of options) select.append(h('option', { value: option.id }, option.label))
  select.value = value
  select.addEventListener('change', () => onChange(select.value as T))
  return selectMenu(select)
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
      h('p', { class: 'hint', id: 'dictation-model-note' }, `Runs on this PC with Whisper, so your voice never leaves it. The model downloads once on first use (${DICTATION_MODELS.find((m) => m.id === settings.model)?.size ?? ''}) and is kept in Dawsha's data folder, so dictation then works offline. Small is more accurate but slower and several times bigger.`)
    )
  ]
}
