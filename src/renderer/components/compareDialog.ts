import { AGENTS, agentLabel } from '../../shared/agents'
import { COMPARE_PROMPT_MAX, compareNames, shortId } from '../../shared/compare'
import type { AgentKind, Project, RepoProbe } from '../../shared/types'
import { api } from '../api'
import { startCompare } from '../compareActions'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'
import { selectMenu } from './selectMenu'

export interface CompareDialogOptions {
  projects: Project[]
  projectId: string
}

function agentSelect(id: string, value: AgentKind): HTMLSelectElement {
  const select = h('select', { class: 'rp-project field-select', id })
  for (const agent of AGENTS) select.append(h('option', { value: agent }, agentLabel(agent)))
  select.value = value
  return select
}

function field(label: string, id: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'field' }, h('label', { for: id, class: 'dialog-label' }, label), control)
}

function worktreeNote(probe: RepoProbe | null, project: Project | undefined, short: string): string {
  if (!probe || !project) return 'Checking the folder...'
  if (!probe.isRepo) return 'This folder is not a git repository, so both agents work in the same folder.'
  if (!probe.hasCommits) return 'This repository has no commits yet, so worktrees cannot start from HEAD.'
  const sides = compareNames(project.folder, short)
  const from = probe.branch ? ` from ${probe.branch}` : ''
  return `Creates ${sides.a.path} and ${sides.b.path} on new branches${from}.`
}

export function compareDialog(options: CompareDialogOptions): Promise<boolean> {
  const id = nextDialogId()
  let short = shortId()
  let probe: RepoProbe | null = null
  let busy = false
  const project = h('select', { class: 'rp-project field-select', id: `cmp-project-${id}` })
  for (const item of options.projects) project.append(h('option', { value: item.id }, item.name))
  project.value = options.projectId
  const agentA = agentSelect(`cmp-a-${id}`, 'claude')
  const agentB = agentSelect(`cmp-b-${id}`, 'codex')
  const prompt = h('textarea', {
    class: 'text-input dialog-text',
    id: `cmp-prompt-${id}`,
    rows: '4',
    maxlength: String(COMPARE_PROMPT_MAX),
    placeholder: 'Why does the login test fail on CI but not locally?',
    spellcheck: 'false'
  })
  const worktrees = h('input', { type: 'checkbox', id: `cmp-worktrees-${id}`, checked: true })
  const note = h('p', { class: 'dialog-hint compare-note' })
  const error = h('pre', { class: 'compare-error', role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const submit = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, 'Ask both')
  const selected = (): Project | undefined => options.projects.find((item) => item.id === project.value)

  const dialog = h(
    'div',
    { class: 'dialog compare-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ask two agents' },
    h('h2', {}, 'Ask two agents'),
    h('p', { class: 'dialog-hint' }, 'Send one prompt to two agents at once and compare what they do.'),
    field('Project', project.id, selectMenu(project)),
    h('div', { class: 'field-row' }, field('Agent A', agentA.id, selectMenu(agentA)), field('Agent B', agentB.id, selectMenu(agentB))),
    field('Prompt', prompt.id, prompt),
    h(
      'label',
      { class: 'compare-check', for: worktrees.id },
      worktrees,
      "Start each in its own git worktree so their edits don't collide"
    ),
    note,
    error,
    h('div', { class: 'dialog-actions' }, cancel, submit)
  )
  const shown = present<boolean>(dialog, false, prompt)

  const refreshNote = (): void => {
    note.textContent = worktreeNote(probe, selected(), short)
    const usable = probe?.isRepo === true && probe.hasCommits
    worktrees.disabled = !usable || busy
    submit.disabled = busy || probe === null
    if (!usable) worktrees.checked = false
  }
  const probeProject = async (): Promise<void> => {
    probe = null
    refreshNote()
    const current = selected()
    if (!current) return
    const result = await api.compareProbe(current.folder)
    if (selected() !== current) return
    probe = result
    worktrees.checked = result.isRepo && result.hasCommits
    refreshNote()
  }
  const setBusy = (value: boolean): void => {
    busy = value
    for (const control of [project, agentA, agentB, prompt, cancel, submit]) control.disabled = value
    submit.textContent = value ? 'Starting...' : 'Ask both'
    refreshNote()
  }
  const showError = (message: string | null): void => {
    error.textContent = message ?? ''
    error.hidden = message === null
  }

  project.addEventListener('change', () => void probeProject())
  prompt.addEventListener('input', () => showError(null))
  cancel.addEventListener('click', () => shown.finish(false))
  submit.addEventListener('click', async () => {
    const text = prompt.value.trim()
    if (text === '') return showError('Enter the prompt to send to both agents.')
    const chosen = selected()
    if (!chosen) return showError('Choose a project.')
    showError(null)
    const useWorktrees = worktrees.checked && !worktrees.disabled
    setBusy(true)
    const result = await startCompare({
      projectId: chosen.id,
      agentA: agentA.value as AgentKind,
      agentB: agentB.value as AgentKind,
      prompt: text,
      worktrees: useWorktrees,
      short
    })
    setBusy(false)
    if (result.ok) return shown.finish(true)
    short = shortId()
    showError(result.error)
    refreshNote()
  })
  void probeProject()
  return shown.result
}
