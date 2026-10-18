import type { KeyBinding, KeyEventLike } from '../../shared/shortcuts'
import { matchesBinding } from '../../shared/shortcuts'
import type { PaletteItem } from '../../shared/palette'
import type { AgentKind } from '../../shared/types'
import type { AppState } from '../state'

export interface Command extends PaletteItem {
  shortcut?: string
  keys?: KeyBinding[]
  scope?: 'grid'
  hint?: string
  mark?: AgentKind
  enabled?: (state: AppState) => boolean
  run(): void | Promise<void>
}

type Provider = (state: AppState) => Command[]

const statics = new Map<string, Command>()
const providers: Provider[] = []

export function registerCommands(...commands: Command[]): void {
  for (const command of commands) statics.set(command.id, command)
}

export function registerProvider(provider: Provider): void {
  providers.push(provider)
}

// Every command, also those that are not usable right now: the shortcuts sheet is a reference.
export function listAllCommands(state: AppState): Command[] {
  return [...statics.values(), ...providers.flatMap((provider) => provider(state))]
}

export function listCommands(state: AppState): Command[] {
  const all = [...statics.values(), ...providers.flatMap((provider) => provider(state))]
  return all.filter((command) => command.enabled?.(state) !== false)
}

export const shortcutFor = (id: string): string | undefined => statics.get(id)?.shortcut

export function findCommand(state: AppState, id: string): Command | undefined {
  return listCommands(state).find((command) => command.id === id)
}

export function commandForEvent(event: KeyEventLike, state: AppState): Command | null {
  const gridView = state.view === 'grid'
  return (
    listCommands(state).find(
      (command) =>
        (command.scope !== 'grid' || gridView) &&
        (command.keys ?? []).some((binding) => matchesBinding(event, binding))
    ) ?? null
  )
}
