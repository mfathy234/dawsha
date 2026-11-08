import { presetSummary } from '../../shared/sessionPresets'
import { deletePresetFromUi, renamePresetFromUi } from '../presetActions'
import { h } from '../dom'
import type { AppState } from '../state'

/** The Session presets block of Settings > Agents: each preset with Rename and Delete. */
export function presetsSettings(state: AppState): HTMLElement[] {
  const { presets, projects } = state.settings
  const heading = h('h3', { class: 'set-subhead', id: 'presets-heading' }, 'Session presets')
  const hint = h('p', { class: 'hint' }, 'Save one from New session. Presets start from New session and the command palette.')
  if (presets.length === 0) return [heading, hint, h('p', { class: 'hint', id: 'presets-empty' }, 'No presets yet.')]
  const rows = presets.map((preset) =>
    h(
      'div',
      { class: 'set-row', 'data-preset': preset.id },
      h(
        'div',
        { class: 'set-main' },
        h('div', { class: 'set-name' }, preset.name),
        h('p', { class: 'hint' }, presetSummary(preset, projects.find((project) => project.id === preset.projectId)?.name))
      ),
      h(
        'div',
        { class: 'set-control' },
        h('div', { class: 'set-inline' },
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Rename ${preset.name}`, onClick: () => void renamePresetFromUi(preset.id) }, 'Rename'),
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Delete ${preset.name}`, onClick: () => void deletePresetFromUi(preset.id) }, 'Delete')
        )
      )
    )
  )
  return [heading, hint, ...rows]
}
