import { DICTATION_LANGUAGES, modelInfo, sanitizeDictation, type DictationLanguage, type DictationSettings } from '../../shared/dictation'
import { saveSettings } from '../actions'
import { nextDialogId, present } from '../components/dialogs'
import { h } from '../dom'
import { store } from '../state'
import { selectMenu } from '../components/selectMenu'

export function setDictation(change: Partial<DictationSettings>): void {
  const dictation = sanitizeDictation({ ...store.state.settings.dictation, ...change })
  store.set((s) => ({ ...s, settings: { ...s.settings, dictation } }))
  void saveSettings({ dictation })
}

/** The first time the mic is used: says that speech stays on this PC and how big the download is. */
export async function confirmDictationIntro(): Promise<boolean> {
  const id = nextDialogId()
  const titleId = `dlg-title-${id}`
  const bodyId = `dlg-body-${id}`
  const settings = store.state.settings.dictation
  const model = modelInfo(settings.model)
  const language = h('select', { class: 'field-select', id: 'dictation-intro-language', 'aria-label': 'Spoken language' })
  for (const option of DICTATION_LANGUAGES) language.append(h('option', { value: option.id }, option.label))
  language.value = settings.language
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Not now')
  const start = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, 'Start dictating')
  const dialog = h(
    'div',
    { class: 'dialog dictation-intro', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': bodyId },
    h('h2', { id: titleId }, 'Voice dictation'),
    h(
      'p',
      { id: bodyId },
      `Speech becomes text on this computer, so your voice never leaves it. The first time, Dawsha downloads the speech model (${model.label}, ${model.size}) and keeps it for offline use. Text is typed where you were, and nothing is sent until you press Enter.`
    ),
    h('label', { class: 'field-label', for: 'dictation-intro-language' }, 'Spoken language'),
    selectMenu(language),
    h('p', { class: 'hint' }, 'Change the language, model or microphone later in Settings > Voice dictation.'),
    h('div', { class: 'dialog-actions' }, cancel, start)
  )
  const shown = present(dialog, false, start)
  cancel.addEventListener('click', () => shown.finish(false))
  start.addEventListener('click', () => shown.finish(true))
  const confirmed = await shown.result
  if (confirmed) setDictation({ introShown: true, language: language.value as DictationLanguage })
  return confirmed
}
