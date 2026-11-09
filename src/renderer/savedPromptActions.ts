import { addSavedPrompt, removeSavedPrompt, renameSavedPrompt, validatePromptName, type SavedPrompt } from '../shared/savedPrompts'
import { saveSettings } from './actions'
import { confirmDialog, promptDialog } from './components/dialogs'
import { store } from './state'

const current = (): readonly SavedPrompt[] => store.state.settings.savedPrompts

function keep(savedPrompts: SavedPrompt[]): void {
  store.set((state) => ({ ...state, settings: { ...state.settings, savedPrompts } }))
  void saveSettings({ savedPrompts })
}

export function createSavedPrompt(name: string, text: string): SavedPrompt {
  const prompt = { id: crypto.randomUUID(), name: name.trim(), text }
  keep(addSavedPrompt(current(), prompt))
  return prompt
}

/** Asks for a name, then keeps the prompt. Null when the person cancels. */
export async function askAndSavePrompt(text: string, suggestion: string, copy: { title: string; label: string; confirmLabel: string }): Promise<SavedPrompt | null> {
  const name = await promptDialog({ ...copy, initial: suggestion, validate: (value) => validatePromptName(value, current()) })
  return name === null ? null : createSavedPrompt(name, text)
}

export async function renamePrompt(prompt: SavedPrompt): Promise<void> {
  const name = await promptDialog({
    title: `Rename "${prompt.name}"`,
    label: 'Name',
    initial: prompt.name,
    confirmLabel: 'Rename',
    validate: (value) => validatePromptName(value, current(), prompt.id)
  })
  if (name !== null) keep(renameSavedPrompt(current(), prompt.id, name))
}

/** Deleting asks first, naming the prompt in the message and on the button. */
export async function deletePrompt(prompt: SavedPrompt): Promise<void> {
  const confirmed = await confirmDialog({
    title: 'Delete saved prompt?',
    body: `"${prompt.name}" will be removed from the / list in every chat. This cannot be undone.`,
    confirmLabel: `Delete "${prompt.name}"`
  })
  if (confirmed) keep(removeSavedPrompt(current(), prompt.id))
}
