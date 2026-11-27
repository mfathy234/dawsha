import { NOTE_MAX, RULE_TRIES_DEFAULT, RULE_TRIES_MAX, SNOOZE_LABELS, noteStamp, type DoneRule, type RulePass, type SnoozeChoice } from '../../shared/sessionCare'
import { MAX_CHECKS } from '../../shared/turnChecks'
import type { RunCommand } from '../../shared/runCommands'
import { api } from '../api'
import { derivePanes } from '../derive'
import { h } from '../dom'
import { prStateOf } from '../prWatch'
import { careOf, setNote, setRule, snoozePane } from '../sessionCare'
import { folderOfPane, paneById, projectById, store } from '../state'
import { nextDialogId, present, promptDialog } from './dialogs'
import { toast } from './toast'
import '../chat/turnExtras.css'
import './care.css'

const titleOf = (paneId: string): string => derivePanes(store.state).find((view) => view.pane.id === paneId)?.title ?? 'this session'

/** "Add note…": one line, "Next: …", for the owner's own next step. */
export async function editNote(paneId: string): Promise<void> {
  const existing = careOf(store.state, paneId)?.note
  const text = await promptDialog({
    title: existing ? 'Edit note' : 'Add note',
    label: `Next step for ${titleOf(paneId)}`,
    initial: existing?.text ?? '',
    hint: existing ? `Written ${noteStamp(existing, Date.now())}. Clear the text to remove it.` : 'Shown as "Next: …" in the tooltip, the inbox and when you resume.',
    confirmLabel: 'Save',
    validate: (value) => (value.length > NOTE_MAX ? `Use at most ${NOTE_MAX} characters.` : null)
  })
  if (text !== null) setNote(paneId, text)
}

/** "Snooze…": a few ways to put a session out of sight until it matters again. */
export async function openSnooze(paneId: string): Promise<void> {
  const id = nextDialogId()
  const choices: SnoozeChoice[] = prStateOf(paneId) ? ['hour', 'tomorrow', 'checks', 'needs'] : ['hour', 'tomorrow', 'needs']
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const buttons = choices.map((choice) => h('button', { class: 'care-choice', type: 'button', 'data-snooze': choice }, SNOOZE_LABELS[choice]))
  const dialog = h('div', { class: 'dialog care-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}` },
    h('h2', { id: `dlg-title-${id}` }, `Snooze ${titleOf(paneId)}`),
    h('p', {}, 'It leaves the tabs and the sidebar, and comes back by itself. It comes back early if it needs you.'),
    h('div', { class: 'care-list', role: 'group', 'aria-label': 'Snooze until' }, ...buttons),
    h('div', { class: 'dialog-actions' }, cancel))
  const shown = present<SnoozeChoice | null>(dialog, null, buttons[0])
  for (const [index, button] of buttons.entries()) button.addEventListener('click', () => shown.finish(choices[index]))
  cancel.addEventListener('click', () => shown.finish(null))
  const choice = await shown.result
  if (choice) snoozePane(paneId, choice)
}

const PASS_CHOICES: { value: RulePass; label: string }[] = [
  { value: 'nothing', label: 'Do nothing' },
  { value: 'commit', label: 'Ask the agent to commit' },
  { value: 'notify', label: 'Notify me' }
]

function commandRow(command: RunCommand, picked: Set<string>): HTMLElement {
  const box = h('input', { type: 'checkbox' })
  box.checked = picked.has(command.id)
  box.addEventListener('change', () => {
    if (box.checked && picked.size >= MAX_CHECKS) {
      box.checked = false
      return toast(`Pick at most ${MAX_CHECKS} commands.`, 'info')
    }
    if (box.checked) picked.add(command.id)
    else picked.delete(command.id)
  })
  return h('label', { class: 'turn-pick-row' }, box, h('span', { class: 'turn-pick-name', dir: 'ltr' }, command.display || command.name))
}

/** "When done…": run the project's commands after each finished turn, send failures back, then do one thing on a pass. */
export async function editRule(paneId: string): Promise<void> {
  const pane = paneById(store.state, paneId)
  const folder = pane ? folderOfPane(store.state, pane) : null
  const project = pane ? projectById(store.state, pane.projectId) : undefined
  if (!pane || !folder || !project) return toast('That session is gone.', 'info')
  const found = await api.runs.discover({ projectId: project.id, folder }).catch((error: Error) => {
    toast(error.message || 'Could not read the run commands of this project.', 'error')
    return null
  })
  if (!found) return
  const existing = careOf(store.state, paneId)?.rule
  const picked = new Set(existing?.commandIds ?? store.state.settings.turnChecks?.[project.id]?.commandIds ?? [])
  const id = nextDialogId()
  const tries = h('input', { class: 'text-input care-tries', type: 'number', min: 1, max: RULE_TRIES_MAX, value: String(existing?.tries ?? RULE_TRIES_DEFAULT), 'aria-label': 'Times a failure goes back to the agent' })
  const pass = h('select', { class: 'text-input', 'aria-label': 'If the commands pass' }, ...PASS_CHOICES.map((choice) => h('option', { value: choice.value }, choice.label)))
  pass.value = existing?.onPass ?? 'nothing'
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const off = h('button', { class: 'btn ghost', type: 'button', hidden: existing === undefined }, 'Turn off')
  const save = h('button', { class: 'btn primary', type: 'button', disabled: found.commands.length === 0 }, 'Save')
  const rows = found.commands.map((command) => commandRow(command, picked))
  const dialog = h('div', { class: 'dialog turn-pick care-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}` },
    h('h2', { id: `dlg-title-${id}` }, `When ${titleOf(paneId)} is done`),
    h('p', {}, "Run these in the session's folder after each finished turn."),
    rows.length > 0 ? h('div', { class: 'turn-pick-list', role: 'group', 'aria-label': 'Run commands' }, ...rows) : h('p', { class: 'chat-quiet' }, 'This project has no run commands yet. Add some from the Run panel in Files.'),
    h('label', { class: 'care-field' }, h('span', {}, 'If they fail, send the output back up to'), tries, h('span', {}, 'times')),
    h('label', { class: 'care-field' }, h('span', {}, 'If they pass'), pass),
    h('p', { class: 'dialog-hint' }, 'Typing in the session stops this until its next finished turn.'),
    h('div', { class: 'dialog-actions' }, off, cancel, save))
  const shown = present<'save' | 'off' | null>(dialog, null, rows.length > 0 ? cancel : cancel)
  cancel.addEventListener('click', () => shown.finish(null))
  off.addEventListener('click', () => shown.finish('off'))
  save.addEventListener('click', () => shown.finish('save'))
  const result = await shown.result
  if (result === 'off') return setRule(paneId, null)
  if (result !== 'save') return
  const commandIds = found.commands.map((command) => command.id).filter((commandId) => picked.has(commandId))
  if (commandIds.length === 0) return setRule(paneId, null)
  const rule: DoneRule = { commandIds, tries: Math.min(RULE_TRIES_MAX, Math.max(1, Math.round(Number(tries.value) || RULE_TRIES_DEFAULT))), onPass: PASS_CHOICES.some((choice) => choice.value === pass.value) ? (pass.value as RulePass) : 'nothing' }
  setRule(paneId, rule)
  toast(`${titleOf(paneId)} will run its checks when it is done.`, 'info')
}
