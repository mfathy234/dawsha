import { commandDuration, type ShellCommand } from '../shared/shellCommands'
import type { TerminalOscHost } from './terminalOsc'
import type { TerminalShellHost } from './terminalShell'
import { api } from './api'
import { confirmDialog } from './components/dialogs'
import { toast } from './components/toast'
import { store } from './state'
import { getTerminal } from './terminals'
import { terminalAgent, terminalDirectory, terminalPane, setTerminalDirectory } from './terminalSession'
import { setTerminalProgress } from './terminalProgress'
import { openShellHistory, sendShellCommand } from './shellUi'

export function oscHost(id: string): TerminalOscHost {
  return {
    directory: (folder) => setTerminalDirectory(id, folder),
    progress: (value) => setTerminalProgress(id, value),
    allowClipboard: () => confirmDialog({ title: 'Allow this session to set your clipboard?', body: 'Terminal programs in this session will be able to replace the text on your clipboard.', confirmLabel: 'Allow', cancelLabel: 'Deny', danger: false }),
    clipboard: (text) => api.writeClipboard(text)
  }
}

function complete(id: string, command: ShellCommand): void {
  const pane = terminalPane(id)
  if (!pane) return
  void api.addShellHistory(pane.projectId, command.command, terminalDirectory(id) ?? '').catch(() => toast('Could not save shell history.'))
  const settings = store.state.settings
  const element = getTerminal(id)?.el
  const visible = element?.classList.contains('active') && (element.getClientRects().length ?? 0) > 0
  if (command.durationMs < 30_000 || (visible && store.state.windowFocused) || !settings.sessionInfo.notifications || !settings.notifyLongCommands) return
  const status = command.exitCode === 0 ? '✓' : command.exitCode === null ? '–' : '✗'
  api.notify({ paneId: pane.id, title: `${status} ${command.command}`.slice(0, 160), body: `${commandDuration(command.durationMs)} · ${settings.projects.find((project) => project.id === pane.projectId)?.name ?? 'Shell'}`, sound: settings.sessionInfo.sound })
}

export function shellHost(id: string): TerminalShellHost {
  return {
    enabled: () => terminalAgent(id) === 'shell',
    complete: (command) => complete(id, command),
    rerun: (command) => { getTerminal(id)?.insertText(command); api.write(id, '\r'); getTerminal(id)?.focus() },
    copy: (output) => { void api.writeClipboard(output).catch(() => toast('Could not copy shell output.')) },
    send: (command, output) => { void sendShellCommand(command, output) },
    history: () => { void openShellHistory(id) }
  }
}
