import { bind, formatShortcut } from '../../shared/shortcuts'
import { showView, toggleStarred } from '../actions'
import { openBroadcast } from '../components/broadcastDialog'
import { editNote, editRule, openSnooze } from '../components/careDialogs'
import { paneById, store, type AppState } from '../state'
import { registerCommands, type Command } from './registry'

const hasPane = (state: AppState): boolean => paneById(state, state.focusedId) !== undefined

function focused(id: string, title: string, run: (paneId: string) => unknown, keywords: string): Command {
  return {
    id, title, group: 'Actions', keywords, enabled: hasPane,
    run: () => {
      const paneId = store.state.focusedId
      if (paneId) void run(paneId)
    }
  }
}

/** The inbox and the per-session extras: a note, a snooze, a when-done rule and a message to several sessions. */
export function installSessionCareCommands(): void {
  registerCommands(
    { id: 'view.inbox', title: 'Open inbox', group: 'Actions', keywords: 'inbox needs you unread done waiting answer reply sessions', keys: [bind('Ctrl+I')], shortcut: formatShortcut(bind('Ctrl+I')), run: () => showView(store.state.view === 'inbox' ? 'grid' : 'inbox') },
    { id: 'session.broadcast', title: 'Send to several sessions…', group: 'Actions', keywords: 'broadcast message all idle sessions send many', run: () => void openBroadcast() },
    focused('session.note', 'Add a note to this session…', editNote, 'next step reminder'),
    focused('session.pin-top', 'Pin this session to top (or unpin)', toggleStarred, 'star favourite keep first'),
    focused('session.snooze', 'Snooze this session…', openSnooze, 'hide later tomorrow'),
    focused('session.when-done', 'When this session is done…', editRule, 'rule checks tests commit after turn')
  )
}
