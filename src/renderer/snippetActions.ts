import { SNIPPET_TEXT_MAX } from '../shared/settingsSchema'
import { expandSnippet, usesSelection, type SnippetDraft } from '../shared/snippets'
import { suggestSnippetName } from '../shared/terminalText'
import type { Snippet } from '../shared/types'
import { saveSettings } from './actions'
import { api } from './api'
import { confirmDialog } from './components/dialogs'
import { snippetDialog } from './components/snippetDialog'
import { toast } from './components/toast'
import { folderOfPane, newId, paneById, projectById, store } from './state'
import { getTerminal } from './terminals'

// Electron prefixes errors thrown in main with the channel and error class; the reason after it is what matters.
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error(?: \[\w+\])?: )?/

type SnippetPrefill = { name: string; text: string; projectId: string | null }

function setSnippets(snippets: Snippet[]): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, snippets } }))
  void saveSettings({ snippets })
}

export function insertSnippet(snippet: Snippet): boolean {
  const state = store.state
  const pane = paneById(state, state.focusedId)
  const tab = pane?.tabs.find((t) => t.id === pane.activeTabId)
  const project = pane ? projectById(state, pane.projectId) : undefined
  const view = tab ? getTerminal(tab.id) : undefined
  if (!pane || !tab || !project || !view) {
    toast('Open a session first, then insert the snippet.', 'info')
    return false
  }
  if (tab.status === 'exited') {
    toast(`${tab.label} has exited. Restart it before inserting a snippet.`)
    return false
  }
  const selection = view.selection().trim()
  if (usesSelection(snippet.text) && selection === '') {
    toast(`Select some text in the terminal first, then insert '${snippet.name}' again.`, 'info')
    return false
  }
  const folder = folderOfPane(state, pane) ?? project.folder
  const text = expandSnippet(snippet.text, {
    selection,
    branch: state.branches[folder] ?? '',
    project: project.name,
    folder
  })
  const { flattened } = view.insertText(text)
  const note = flattened ? ' Its line breaks were joined because this terminal does not accept pasted lines.' : ''
  toast(`Inserted '${snippet.name}'. Press Enter to send it.${note}`, 'info')
  view.focus()
  return true
}

function snippetFromDraft(draft: SnippetDraft, existing: Snippet | undefined): Snippet {
  return {
    id: existing?.id ?? newId(),
    name: draft.name.trim(),
    text: draft.text,
    projectId: draft.projectId,
    shortcut: draft.shortcut
  }
}

/** Writes the list to settings first and only then shows it, so a failed write never looks saved. */
async function storeSnippets(snippets: Snippet[]): Promise<string | null> {
  try {
    await api.updateSettings({ snippets })
  } catch (error) {
    const reason = ((error as Error).message ?? '').replace(IPC_ERROR_PREFIX, '').trim()
    return `Could not save the snippet. ${reason || 'Settings could not be written.'}`
  }
  store.set((s) => ({ ...s, settings: { ...s.settings, snippets } }))
  return null
}

export async function editSnippet(snippetId?: string, prefill?: SnippetPrefill): Promise<void> {
  const existing = snippetId ? store.state.settings.snippets.find((s) => s.id === snippetId) : undefined
  let saved: Snippet | undefined
  const draft = await snippetDialog({
    snippet: existing,
    prefill,
    snippets: store.state.settings.snippets,
    projects: store.state.settings.projects,
    save: (value) => {
      const next = snippetFromDraft(value, existing)
      const { snippets } = store.state.settings
      saved = next
      return storeSnippets(existing ? snippets.map((s) => (s.id === existing.id ? next : s)) : [...snippets, next])
    }
  })
  if (!draft || !saved) return
  toast(`${existing ? 'Updated' : 'Saved'} snippet '${saved.name}'.`, 'info')
}

export async function deleteSnippet(snippetId: string): Promise<void> {
  const snippet = store.state.settings.snippets.find((s) => s.id === snippetId)
  if (!snippet) return
  const confirmed = await confirmDialog({
    title: `Delete snippet "${snippet.name}"?`,
    body: 'This removes the snippet from Dawsha. Text you already inserted into a terminal is not affected.',
    confirmLabel: `Delete "${snippet.name}"`
  })
  if (!confirmed) return
  setSnippets(store.state.settings.snippets.filter((s) => s.id !== snippet.id))
}

export async function saveSelectionAsSnippet(paneId: string): Promise<void> {
  const pane = paneById(store.state, paneId)
  const view = pane ? getTerminal(pane.activeTabId) : undefined
  const text = view?.selection().replace(/\s+$/, '') ?? ''
  if (!pane || text.trim() === '') {
    toast('Select some text in the terminal first.', 'info')
    return
  }
  if (text.length > SNIPPET_TEXT_MAX) {
    toast(`That selection is ${text.length} characters and a snippet holds at most ${SNIPPET_TEXT_MAX}. Select less text.`)
    return
  }
  await editSnippet(undefined, { name: suggestSnippetName(text), text, projectId: pane.projectId })
}
