import { editTurnChecks } from '../components/turnChecksDialog'
import type { AppState } from '../state'
import { registerProvider, type Command } from './registry'

function checksCommands(state: AppState): Command[] {
  return state.settings.projects.map((project): Command => ({
    id: `checks:${project.id}`,
    title: `Checks after each reply in ${project.name}`,
    group: 'Projects',
    searchOnly: true,
    keywords: 'tests lint build run commands after reply agent',
    run: () => editTurnChecks(project.id)
  }))
}

/** One palette entry per project for choosing the checks that run after a reply. */
export function installTurnChecksCommands(): void {
  registerProvider(checksCommands)
}
