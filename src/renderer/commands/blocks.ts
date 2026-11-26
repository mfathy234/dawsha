import { bind, formatShortcut } from '../../shared/shortcuts'
import { paneById, store, type AppState } from '../state'
import { canJumpBlock, jumpBlock, terminalHasFocus, toggleOutline, toggleReading } from '../terminalActions'
import { registerCommands, type Command } from './registry'

const hasPane = (state: AppState): boolean => paneById(state, state.focusedId) !== undefined

const keys = (text: string): Pick<Command, 'keys' | 'shortcut'> => ({ keys: [bind(text)], shortcut: formatShortcut(bind(text)) })

const focusedPane = (run: (paneId: string) => void) => (): void => {
  const paneId = store.state.focusedId
  if (paneId) run(paneId)
}

/**
 * Registered ahead of the built-in commands: Ctrl+Shift+R and Ctrl+Shift+O are the Reading view and the block outline
 * while a terminal has the keyboard, and keep resuming a session and filtering the sidebar everywhere else.
 */
export function installBlockCommands(): void {
  registerCommands(
    {
      id: 'terminal.reading',
      title: 'Reading view: fold long output',
      group: 'Actions',
      keywords: 'scrollback blocks fold unfold read back long output commands',
      ...keys('Ctrl+Shift+R'),
      keyWhen: terminalHasFocus,
      scope: 'grid',
      enabled: hasPane,
      run: focusedPane(toggleReading)
    },
    {
      id: 'terminal.outline',
      title: 'Block outline: jump to a command or error',
      group: 'Actions',
      keywords: 'blocks list prompts commands errors find jump',
      ...keys('Ctrl+Shift+O'),
      keyWhen: terminalHasFocus,
      scope: 'grid',
      enabled: hasPane,
      run: focusedPane(toggleOutline)
    },
    {
      id: 'terminal.previous-block',
      title: 'Go to the previous block',
      group: 'Actions',
      keywords: 'jump scroll command output tool',
      ...keys('Alt+ArrowUp'),
      keyWhen: terminalHasFocus,
      scope: 'grid',
      enabled: (state) => hasPane(state) && canJumpBlock(-1),
      run: () => jumpBlock(-1)
    },
    {
      id: 'terminal.next-block',
      title: 'Go to the next block',
      group: 'Actions',
      keywords: 'jump scroll command output tool',
      ...keys('Alt+ArrowDown'),
      keyWhen: terminalHasFocus,
      scope: 'grid',
      enabled: (state) => hasPane(state) && canJumpBlock(1),
      run: () => jumpBlock(1)
    }
  )
}
