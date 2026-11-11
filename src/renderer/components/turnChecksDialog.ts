import type { RunCommand } from '../../shared/runCommands'
import { MAX_CHECKS, type TurnChecksConfig, type TurnChecksSettings } from '../../shared/turnChecks'
import { saveSettings } from '../actions'
import { api } from '../api'
import { h } from '../dom'
import { store } from '../state'
import { nextDialogId, present } from './dialogs'
import { toast } from './toast'
import '../chat/turnExtras.css'

interface Choice {
  picked: string[]
  autoSend: boolean
}

function commandRow(command: RunCommand, picked: Set<string>, limitReached: () => boolean): HTMLElement {
  const box = h('input', { type: 'checkbox' })
  box.checked = picked.has(command.id)
  box.addEventListener('change', () => {
    if (box.checked && limitReached()) {
      box.checked = false
      return toast(`Pick at most ${MAX_CHECKS} checks.`, 'info')
    }
    if (box.checked) picked.add(command.id)
    else picked.delete(command.id)
  })
  return h('label', { class: 'turn-pick-row' }, box, h('span', { class: 'turn-pick-name', dir: 'ltr' }, command.display || command.name))
}

/** Stores the choice for the project: no commands ticked removes the setting. */
export function storeTurnChecks(projectId: string, choice: Choice | null): void {
  const { [projectId]: _old, ...others } = store.state.settings.turnChecks ?? {}
  const next: TurnChecksSettings = choice && choice.picked.length > 0 ? { ...others, [projectId]: { commandIds: choice.picked, autoSend: choice.autoSend } satisfies TurnChecksConfig } : others
  store.set((s) => ({ ...s, settings: { ...s.settings, turnChecks: next } }))
  void saveSettings({ turnChecks: next })
}

/** "Checks after each reply in <project>": pick which of the project's run commands run after a reply that changed files. */
export async function editTurnChecks(projectId: string): Promise<void> {
  const project = store.state.settings.projects.find((entry) => entry.id === projectId)
  if (!project) return
  const found = await api.runs.discover({ projectId, folder: project.folder }).catch((error: Error) => {
    toast(error.message || 'Could not read the run commands of this project.', 'error')
    return null
  })
  if (!found) return
  const saved = store.state.settings.turnChecks?.[projectId]
  const picked = new Set(saved?.commandIds ?? [])
  const id = nextDialogId()
  const auto = h('input', { type: 'checkbox' })
  auto.checked = saved?.autoSend === true
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const save = h('button', { class: 'btn primary', type: 'button', disabled: found.commands.length === 0 }, 'Save')
  const rows = found.commands.map((command) => commandRow(command, picked, () => picked.size >= MAX_CHECKS))
  const dialog = h('div', { class: 'dialog turn-pick', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}` },
    h('h2', { id: `dlg-title-${id}` }, `Checks after each reply in ${project.name}`),
    h('p', {}, "These run in the session's folder after any reply that changes files."),
    rows.length > 0 ? h('div', { class: 'turn-pick-list', role: 'group', 'aria-label': 'Run commands' }, ...rows) : h('p', { class: 'chat-quiet' }, 'This project has no run commands yet. Add some from the Run panel in Files.'),
    h('label', { class: 'turn-pick-auto' }, auto, h('span', {}, 'Send failures to the agent automatically, up to 2 times in a row')),
    h('div', { class: 'dialog-actions' }, cancel, save))
  const shown = present<boolean>(dialog, false, rows.length > 0 ? cancel : cancel)
  cancel.addEventListener('click', () => shown.finish(false))
  save.addEventListener('click', () => shown.finish(true))
  if (!(await shown.result)) return
  const ordered = found.commands.map((command) => command.id).filter((commandId) => picked.has(commandId))
  storeTurnChecks(projectId, { picked: ordered, autoSend: auto.checked })
  toast(ordered.length > 0 ? `Checks will run after replies in ${project.name}.` : `No checks after replies in ${project.name}.`, 'info')
}
