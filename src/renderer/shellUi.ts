import { commandMessage } from '../shared/shellCommands'
import { detectPermissionPrompt } from '../shared/permissionPrompt'
import { AGENT_NAMES } from '../shared/agents'
import { api } from './api'
import { h } from './dom'
import { store } from './state'
import { getTerminal } from './terminals'
import { terminalPane } from './terminalSession'
import { choiceDialog, present } from './components/dialogs'
import { toast } from './components/toast'
import { sendChatMessage } from './chat/chatActions'

export async function sendShellCommand(command: string, output: string): Promise<void> {
  const targets = store.state.panes.flatMap((pane) => pane.tabs.filter((tab) => tab.agent !== 'shell' && tab.status === 'running')
    .map((tab) => ({ pane, tab })))
  if (!targets.length) { toast('Open an agent session first.', 'info'); return }
  const id = await choiceDialog({ title: 'Send to a session', body: 'Send this command and its output as a message.', choices: targets.map(({ pane, tab }) => ({
    label: `${tab.name || tab.titleHint || tab.label} · ${store.state.settings.projects.find((p) => p.id === pane.projectId)?.name ?? ''} · ${AGENT_NAMES[tab.agent]}`,
    value: tab.id
  })) })
  const tab = targets.find((target) => target.tab.id === id)?.tab
  if (!tab || !store.state.panes.some((pane) => pane.tabs.some((current) => current.id === tab.id && current.status === 'running'))) return
  const safe = (): boolean => !detectPermissionPrompt(getTerminal(tab.id)?.tailText(24) ?? '')
  if (!safe()) { toast('Answer that session’s permission request first.'); return }
  sendChatMessage(tab.id, tab.agent, commandMessage(command, output), safe)
}

export async function openShellHistory(id: string): Promise<void> {
  const pane = terminalPane(id)
  const terminal = getTerminal(id)
  if (!pane || !terminal || document.querySelector('[aria-label="Project shell history"]')) return
  const history = await api.shellHistory(pane.projectId).catch(() => [])
  const input = h('input', { class: 'palette-input', 'aria-label': 'Search project commands', placeholder: 'Search project commands', autocomplete: 'off' })
  const list = h('div', { class: 'palette-list', role: 'listbox', 'aria-label': 'Project commands' })
  const dialog = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Project shell history' },
    h('div', { class: 'palette-head' }, input), list,
    h('div', { class: 'palette-foot' }, 'Enter types the command. It does not run it.'))
  const shown = present(dialog, null, input)
  let selected = 0
  let matches = history
  const choose = (): void => {
    const command = matches[selected]?.command
    if (!command) return
    shown.finish(null)
    terminal.insertText(command)
    terminal.focus()
  }
  const render = (): void => {
    matches = history.filter((entry) => entry.command.toLowerCase().includes(input.value.toLowerCase()))
    selected = Math.min(selected, Math.max(0, matches.length - 1))
    list.replaceChildren(...matches.map((entry, index) => h('button', {
      class: `palette-row${index === selected ? ' selected' : ''}`, role: 'option', type: 'button',
      'aria-selected': String(index === selected), title: entry.cwd,
      onClick: () => { selected = index; choose() }
    }, entry.command)))
    if (!matches.length) list.append(h('p', { class: 'palette-empty' }, 'No commands yet.'))
    list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
  }
  input.addEventListener('input', () => { selected = 0; render() })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); choose() }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(1, matches.length)
      render()
    }
  })
  render()
}
