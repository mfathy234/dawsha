import { oneLine, type SavedPrompt } from '../../shared/savedPrompts'
import { deletePrompt, renamePrompt } from '../savedPromptActions'
import { h } from '../dom'
import '../chat/chatExtras.css'

function promptRow(prompt: SavedPrompt): HTMLElement {
  return h(
    'div',
    { class: 'set-saved', 'data-saved-prompt': prompt.id },
    h('div', { class: 'set-saved-text' }, h('b', { dir: 'auto' }, prompt.name), h('span', { dir: 'auto' }, oneLine(prompt.text))),
    h(
      'div',
      { class: 'set-saved-acts' },
      h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Rename ${prompt.name}`, onClick: () => void renamePrompt(prompt) }, 'Rename'),
      h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Delete ${prompt.name}`, onClick: () => void deletePrompt(prompt) }, 'Delete')
    )
  )
}

/** The Saved prompts setting: the list with rename and delete, or a line saying how to add one. */
export function savedPromptsRow(prompts: readonly SavedPrompt[]): HTMLElement {
  const list = prompts.length > 0 ? h('div', { class: 'set-views', id: 'saved-prompts' }, ...prompts.map(promptRow)) : null
  const hint = h('p', { class: 'hint' }, prompts.length > 0 ? 'Pick one from the / list in a chat to insert it.' : 'None yet. In a chat, type your prompt, put /save in front of it and pick Save.')
  return h('div', { class: 'set-row' }, h('div', { class: 'set-main' }, h('div', { class: 'set-name' }, 'Saved prompts'), hint, list))
}
