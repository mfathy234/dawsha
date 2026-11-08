import { AGENTS, AGENT_NAMES } from '../../shared/agents'
import { PRESET_PROMPT_MAX, validatePresetName } from '../../shared/sessionPresets'
import type { Project, SessionPreset, TabAgent } from '../../shared/types'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'
import { selectMenu } from './selectMenu'

export type PresetDraft = Omit<SessionPreset, 'id'>

export interface PresetDialogOptions {
  projects: Project[]
  existing: SessionPreset[]
  initial: PresetDraft
}

const PRESET_AGENTS: TabAgent[] = [...AGENTS, 'shell']

function field(label: string, id: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'field' }, h('label', { for: id, class: 'dialog-label' }, label), control)
}

function agentSelect(id: string, value: TabAgent): HTMLSelectElement {
  const select = h('select', { class: 'rp-project field-select', id })
  for (const agent of PRESET_AGENTS) select.append(h('option', { value: agent }, AGENT_NAMES[agent]))
  select.value = value
  return select
}

function projectSelect(id: string, projects: Project[], value: string): HTMLSelectElement {
  const select = h('select', { class: 'rp-project field-select', id })
  for (const project of projects) select.append(h('option', { value: project.id }, project.name))
  select.value = value
  return select
}

/** Asks for the name and settings of a new preset, filled in from the session being set up. Resolves null on cancel. */
export function presetDialog(options: PresetDialogOptions): Promise<PresetDraft | null> {
  const id = nextDialogId()
  const { initial } = options
  const name = h('input', { class: 'text-input', id: `pre-name-${id}`, type: 'text', value: initial.name, autocomplete: 'off', spellcheck: 'false', placeholder: 'Fix a bug in a fresh worktree' })
  const project = projectSelect(`pre-project-${id}`, options.projects, initial.projectId)
  const agent = agentSelect(`pre-agent-${id}`, initial.agent)
  const worktree = h('input', { type: 'checkbox', id: `pre-worktree-${id}`, checked: initial.worktree })
  const prompt = h('textarea', {
    class: 'text-input dialog-text',
    id: `pre-prompt-${id}`,
    rows: '4',
    maxlength: String(PRESET_PROMPT_MAX),
    placeholder: 'Optional. Typed into the session as soon as it starts.',
    spellcheck: 'false'
  })
  prompt.value = initial.prompt
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const save = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, 'Save preset')
  const dialog = h(
    'div',
    { class: 'dialog compare-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Save as preset' },
    h('h2', {}, 'Save as preset'),
    h('p', { class: 'dialog-hint' }, 'Start the same kind of session again from New session or the command palette.'),
    field('Name', name.id, name),
    field('Project', project.id, selectMenu(project)),
    field('Agent', agent.id, selectMenu(agent)),
    h('label', { class: 'compare-check', for: worktree.id }, worktree, 'Start in a new git worktree on its own branch'),
    field('First prompt', prompt.id, prompt),
    error,
    h('div', { class: 'dialog-actions' }, cancel, save)
  )
  const shown = present<PresetDraft | null>(dialog, null, name)
  name.select()
  const submit = (): void => {
    const problem = validatePresetName(name.value, options.existing)
    error.textContent = problem ?? ''
    error.hidden = problem === null
    if (problem) return
    shown.finish({ name: name.value.trim(), agent: agent.value as TabAgent, projectId: project.value, worktree: worktree.checked, prompt: prompt.value.trim() })
  }
  name.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    submit()
  })
  cancel.addEventListener('click', () => shown.finish(null))
  save.addEventListener('click', submit)
  return shown.result
}
