import { clampFontSize, type EditorPrefs, type FilesLayout } from '../../shared/filesLayout'
import { saveSettings } from '../actions'
import { store } from '../state'

/** The remembered Files layout (folded sections, inspector, bottom panel), kept in the app settings so a quick quit keeps it. */
export function filesLayout(): FilesLayout {
  return store.state.settings.filesLayout
}

export function updateLayout(change: (current: FilesLayout) => FilesLayout): FilesLayout {
  const layout = change(filesLayout())
  store.set((state) => ({ ...state, settings: { ...state.settings, filesLayout: layout } }))
  void saveSettings({ filesLayout: layout })
  return layout
}

/** The remembered editor look: font size and word wrap. */
export function editorPrefs(): EditorPrefs {
  return filesLayout().editor
}

export function updateEditorPrefs(change: (current: EditorPrefs) => EditorPrefs): EditorPrefs {
  const next = change(editorPrefs())
  const prefs = { fontSize: clampFontSize(next.fontSize), wrap: next.wrap }
  updateLayout((layout) => ({ ...layout, editor: prefs }))
  return prefs
}
