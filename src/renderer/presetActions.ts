import { shortId } from '../shared/compare'
import { addPreset, removePreset, renamePreset, validatePresetName } from '../shared/sessionPresets'
import type { PaneWorktree, SessionPreset } from '../shared/types'
import { saveSettings, startPresetSession } from './actions'
import { api } from './api'
import { confirmDialog, promptDialog } from './components/dialogs'
import { presetDialog, type PresetDraft } from './components/presetDialog'
import { toast } from './components/toast'
import { newId, projectById, store } from './state'

function setPresets(presets: SessionPreset[]): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, presets } }))
  void saveSettings({ presets })
}

/** Opens the Save as preset dialog and stores the result. `initial` is what the session being set up already chose. */
export async function savePresetFromUi(initial: PresetDraft): Promise<SessionPreset | null> {
  const { projects, presets } = store.state.settings
  if (projects.length === 0) {
    toast('Add a project first, then save a preset for it.', 'info')
    return null
  }
  const draft = await presetDialog({ projects, existing: presets, initial })
  if (!draft) return null
  const preset: SessionPreset = { id: newId(), ...draft }
  setPresets(addPreset(store.state.settings.presets, preset))
  toast(`Saved the preset ${preset.name}.`, 'info')
  return preset
}

export async function renamePresetFromUi(id: string): Promise<void> {
  const preset = store.state.settings.presets.find((item) => item.id === id)
  if (!preset) return
  const name = await promptDialog({
    title: `Rename ${preset.name}`,
    label: 'Preset name',
    initial: preset.name,
    confirmLabel: 'Rename',
    validate: (value) => validatePresetName(value, store.state.settings.presets, id)
  })
  if (name) setPresets(renamePreset(store.state.settings.presets, id, name))
}

export async function deletePresetFromUi(id: string): Promise<void> {
  const preset = store.state.settings.presets.find((item) => item.id === id)
  if (!preset) return
  const confirmed = await confirmDialog({
    title: `Delete the preset ${preset.name}?`,
    body: `The preset ${preset.name} will be removed from New session and the command palette. Sessions already started from it are not affected.`,
    confirmLabel: `Delete ${preset.name}`
  })
  if (confirmed) setPresets(removePreset(store.state.settings.presets, id))
}

async function makeWorktree(folder: string): Promise<PaneWorktree | null> {
  const made = await api.worktreeCreate(folder, shortId())
  if (!made.ok) {
    toast(made.error)
    return null
  }
  return { repo: folder, path: made.path, branch: made.branch }
}

/** Starts the session a preset describes: in a new worktree when it asks for one, with its first prompt. */
export async function startPreset(id: string): Promise<void> {
  const preset = store.state.settings.presets.find((item) => item.id === id)
  if (!preset) return
  const project = projectById(store.state, preset.projectId)
  if (!project) {
    toast(`The project of the preset ${preset.name} no longer exists.`)
    return
  }
  const folder = await api.checkFolder(project.folder)
  if (!folder.ok) {
    toast(folder.error ?? 'The project folder is not usable.')
    return
  }
  const worktree = preset.worktree ? await makeWorktree(project.folder) : undefined
  if (worktree === null) return
  await startPresetSession({ projectId: project.id, agent: preset.agent, worktree, prompt: preset.prompt })
}
