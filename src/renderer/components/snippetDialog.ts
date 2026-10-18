import { SNIPPET_VARIABLES, snippetPreview, snippetProblem, type SnippetDraft } from '../../shared/snippets'
import { SNIPPET_TEXT_MAX } from '../../shared/settingsSchema'
import type { Project, Snippet } from '../../shared/types'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'

export interface SnippetDialogOptions {
  snippet?: Snippet
  prefill?: { name: string; text: string; projectId: string | null }
  snippets: Snippet[]
  projects: Project[]
  /** Stores the draft. Resolves to null once it is saved, or to a message saying why it could not be saved. */
  save: (draft: SnippetDraft) => Promise<string | null>
}

const SHORTCUTS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

function field(label: string, id: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'field' }, h('label', { for: id, class: 'dialog-label' }, label), control)
}

function scopeSelect(id: string, options: SnippetDialogOptions): HTMLSelectElement {
  const select = h('select', { class: 'rp-project field-select', id })
  select.append(h('option', { value: '' }, 'All projects'))
  for (const project of options.projects) select.append(h('option', { value: project.id }, project.name))
  select.value = options.snippet?.projectId ?? options.prefill?.projectId ?? ''
  return select
}

function shortcutSelect(id: string, options: SnippetDialogOptions): HTMLSelectElement {
  const select = h('select', { class: 'rp-project field-select', id })
  select.append(h('option', { value: '' }, 'None'))
  for (const number of SHORTCUTS) select.append(h('option', { value: String(number) }, `Alt+${number}`))
  select.value = options.snippet?.shortcut === null || options.snippet === undefined ? '' : String(options.snippet.shortcut)
  return select
}

export function snippetDialog(options: SnippetDialogOptions): Promise<SnippetDraft | null> {
  const id = nextDialogId()
  const editing = options.snippet !== undefined
  const name = h('input', {
    class: 'text-input',
    id: `sn-name-${id}`,
    type: 'text',
    value: options.snippet?.name ?? options.prefill?.name ?? '',
    autocomplete: 'off',
    spellcheck: 'false'
  })
  const text = h('textarea', { class: 'text-input snippet-text', id: `sn-text-${id}`, rows: '5', spellcheck: 'false' })
  text.value = options.snippet?.text ?? options.prefill?.text ?? ''
  const scope = scopeSelect(`sn-scope-${id}`, options)
  const shortcut = shortcutSelect(`sn-shortcut-${id}`, options)
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true })
  const preview = h('p', { class: 'snippet-preview' })
  const count = h('span', { class: 'snippet-count' })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const save = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, 'Save snippet')
  const variables = h(
    'dl',
    { class: 'snippet-vars' },
    ...SNIPPET_VARIABLES.flatMap((variable) => [
      h('dt', {}, h('code', {}, `{{${variable.name}}}`)),
      h('dd', {}, variable.help)
    ])
  )
  const dialog = h(
    'div',
    { class: 'dialog snippet-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': editing ? 'Edit snippet' : 'New snippet' },
    h('h2', {}, editing ? 'Edit snippet' : 'New snippet'),
    field('Name', name.id, name),
    field('Text', text.id, text),
    h('div', { class: 'snippet-preview-wrap', 'aria-live': 'polite' }, h('span', {}, 'Preview'), preview, count),
    h('div', { class: 'field' }, h('span', { class: 'dialog-label' }, 'Variables'), variables),
    h('div', { class: 'field-row' }, field('Scope', scope.id, scope), field('Shortcut', shortcut.id, shortcut)),
    error,
    h('div', { class: 'dialog-actions' }, h('span', { class: 'dialog-hint' }, 'Ctrl+Enter saves'), cancel, save)
  )
  const shown = present<SnippetDraft | null>(dialog, null, name)
  const draft = (): SnippetDraft => ({
    id: options.snippet?.id,
    name: name.value,
    text: text.value,
    projectId: scope.value === '' ? null : scope.value,
    shortcut: shortcut.value === '' ? null : Number(shortcut.value)
  })
  const updatePreview = (): void => {
    preview.textContent = snippetPreview(text.value, 180) || 'Your snippet preview appears here.'
    count.textContent = `${text.value.length} / ${SNIPPET_TEXT_MAX} characters`
  }
  updatePreview()
  text.addEventListener('input', updatePreview)
  for (const control of [name, text, scope, shortcut]) control.addEventListener('input', () => (error.hidden = true))
  const fields = { name, text, shortcut, count: save }
  const showError = (message: string, target: HTMLElement): void => {
    error.textContent = message
    error.hidden = false
    error.scrollIntoView({ block: 'nearest' })
    target.focus()
  }
  let saving = false
  const submit = async (): Promise<void> => {
    if (saving) return
    const value = draft()
    const problem = snippetProblem(value, options.snippets)
    if (problem) return showError(problem.message, fields[problem.field])
    saving = true
    save.disabled = true
    const failure = await options.save(value).catch((reason: unknown) => (reason as Error).message || 'Could not save the snippet.')
    saving = false
    save.disabled = false
    if (failure === null) shown.finish(value)
    else showError(failure, save)
  }
  cancel.addEventListener('click', () => shown.finish(null))
  save.addEventListener('click', () => void submit())
  name.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    void submit()
  })
  text.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    void submit()
  })
  return shown.result
}
