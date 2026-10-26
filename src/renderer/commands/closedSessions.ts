import { closedPaletteItems } from '../../shared/closedPalette'
import { openSessionKeys, startSession } from '../actions'
import type { AppState } from '../state'
import { registerProvider, type Command } from './registry'

function closedSessionCommands(state: AppState): Command[] {
  const items = closedPaletteItems(state.settings.keptSessions, state.settings.projects, openSessionKeys(state), state.now)
  return items.map(({ session, ...item }) => ({
    ...item,
    mark: session.agent,
    run: () => void startSession(session.projectId, session.agent, session.sessionId, true, session.title)
  }))
}

export function installClosedSessionCommands(): void {
  registerProvider(closedSessionCommands)
}
