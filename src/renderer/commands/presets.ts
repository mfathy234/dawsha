import { presetCommandTitle, presetSummary } from '../../shared/sessionPresets'
import { startPreset } from '../presetActions'
import type { AppState } from '../state'
import { registerProvider, type Command } from './registry'

function presetCommands(state: AppState): Command[] {
  return state.settings.presets.map((preset) => ({
    id: `preset:${preset.id}`,
    title: presetCommandTitle(preset),
    group: 'Actions',
    hint: presetSummary(preset, state.settings.projects.find((project) => project.id === preset.projectId)?.name),
    keywords: `preset session new start ${preset.agent}`,
    run: () => void startPreset(preset.id)
  }))
}

export function installPresetCommands(): void {
  registerProvider(presetCommands)
}
