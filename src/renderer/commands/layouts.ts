import { layoutSlug } from '../../shared/layouts'
import { toggleLayouts } from '../actions'
import { openLayoutFromUi, saveCurrentLayout } from '../layoutActions'
import type { AppState } from '../state'
import { registerCommands, registerProvider, type Command } from './registry'

function layoutCommands(state: AppState): Command[] {
  return state.settings.layouts.map((layout) => ({
    id: `layout:${layout.id}`,
    title: `Open "${layout.name}"`,
    group: 'Layouts',
    hint: `dawsha open ${layoutSlug(layout.name)}`,
    keywords: 'layout workspace',
    run: () => void openLayoutFromUi(layout)
  }))
}

export function installLayoutCommands(): void {
  registerCommands(
    {
      id: 'layout.save',
      title: 'Save current layout…',
      group: 'Actions',
      keywords: 'layout workspace panes',
      enabled: (state) => state.panes.length > 0,
      run: () => void saveCurrentLayout()
    },
    {
      id: 'layout.manage',
      title: 'Show saved layouts',
      group: 'Actions',
      keywords: 'layout rename delete',
      run: () => toggleLayouts(true)
    }
  )
  registerProvider(layoutCommands)
}
