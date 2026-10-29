import {
  CREW_COLOURS,
  PERMISSION_LABELS,
  STARTUP_LABELS,
  initialsOf,
  modelChoices,
  modelLabel,
  templateFields,
  type CrewColour,
  type CrewEffort,
  type CrewMember,
  type CrewPermissions,
  type CrewStartup,
  type PasteKind
} from '../../shared/crew'
import { CODEX_SANDBOX_NOTE, commandPreview, composeInstructions } from '../../shared/crewLaunch'
import type { AgentKind } from '../../shared/types'
import { AGENT_NAMES } from '../../shared/agents'
import { clear, h } from '../dom'
import { agentMark } from './agentMark'

const PERMISSION_HINTS: Record<CrewPermissions, string> = {
  read: 'Claude uses plan mode. Codex and Gemini are told in words.',
  ask: 'Asks before it edits or runs anything.',
  full: 'Edits and runs without asking.'
}

const STARTUP_HINTS: Record<CrewStartup, string> = {
  lean: 'No MCP servers. About 40% cheaper.',
  some: 'Only the servers in the project’s .mcp.json.',
  usual: 'Every server you normally have.'
}

const EFFORTS: { value: CrewEffort; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' }
]

const PASTE_LABELS: Record<PasteKind, string> = {
  guid: 'an id (with dev, stage or uat)',
  pr: 'a PR number or link',
  build: 'a build link',
  url: 'any link'
}

export interface SetupHandlers {
  current(): CrewMember
  change(patch: Partial<CrewMember>): void
  /** Rebuilds the form, for choices that change which other controls apply. */
  rebuild(): void
}

function group(title: string): HTMLElement {
  return h('div', { class: 'crew-group-title' }, title)
}

function row(label: string, control: Node, hint?: string | Node): HTMLElement[] {
  return [
    h('label', { class: 'crew-label' }, label),
    h('div', { class: 'crew-control' }, control, hint ? h('div', { class: 'crew-hint' }, hint) : null)
  ]
}

function radios<T extends string>(label: string, options: { value: T; label: string; hint?: string }[], current: T, disabled: boolean, onPick: (value: T) => void): HTMLElement {
  const wrap = h('div', { class: 'crew-radios', role: 'radiogroup', 'aria-label': label })
  for (const option of options) {
    const button = h(
      'button',
      { class: 'crew-radio', type: 'button', role: 'radio', 'aria-checked': String(option.value === current), 'data-value': option.value, disabled },
      h('span', {}, option.label),
      option.hint ? h('small', {}, option.hint) : null
    )
    button.addEventListener('click', () => onPick(option.value))
    wrap.append(button)
  }
  return wrap
}

export function colourSwatches(current: CrewColour, disabled: boolean, onPick: (colour: CrewColour) => void): HTMLElement {
  const wrap = h('div', { class: 'crew-swatches', role: 'radiogroup', 'aria-label': 'Colour' })
  for (const colour of CREW_COLOURS) {
    const button = h(
      'button',
      { class: 'crew-swatch', type: 'button', role: 'radio', 'aria-checked': String(colour === current), 'aria-label': colour, title: colour, 'data-colour': colour, disabled, style: `--c:var(--id-${colour})` },
      h('span', {})
    )
    button.addEventListener('click', () => onPick(colour))
    wrap.append(button)
  }
  return wrap
}

function textInput(label: string, value: string, readOnly: boolean, max: number, onInput: (value: string) => void, size?: string): HTMLInputElement {
  const input = h('input', { class: `text-input${size ? ` crew-in-${size}` : ''}`, type: 'text', 'aria-label': label, maxlength: String(max), autocomplete: 'off', spellcheck: 'false' })
  input.value = value
  input.readOnly = readOnly
  input.addEventListener('input', () => onInput(input.value))
  return input
}

function textArea(label: string, value: string, rows: number, readOnly: boolean, mono: boolean, onInput: (value: string) => void): HTMLTextAreaElement {
  const area = h('textarea', { class: `text-input crew-area${mono ? ' mono' : ''}`, rows: String(rows), 'aria-label': label, spellcheck: 'false' })
  area.value = value
  area.readOnly = readOnly
  area.addEventListener('input', () => onInput(area.value))
  return area
}

export function fieldChips(prompt: string): HTMLElement {
  const fields = templateFields(prompt)
  return h('div', { class: 'crew-vars' }, ...fields.map((field) => h('code', {}, `{{${field}}}`)))
}

function runnerCards(member: CrewMember, disabled: boolean, handlers: SetupHandlers): HTMLElement {
  const wrap = h('div', { class: 'crew-models', role: 'radiogroup', 'aria-label': 'Runs on' })
  const blurbs: Record<AgentKind, string> = { claude: 'fable, opus, sonnet, haiku', codex: 'default, gpt-5.6, gpt-5.6-sol', gemini: 'default, 2.5 pro, 2.5 flash' }
  for (const runner of ['claude', 'codex', 'gemini'] as AgentKind[]) {
    const button = h(
      'button',
      { class: 'crew-model', type: 'button', role: 'radio', 'aria-checked': String(member.runner === runner), 'data-runner': runner, disabled },
      agentMark(runner),
      h('b', {}, runner === 'claude' ? 'Claude Code' : AGENT_NAMES[runner]),
      h('small', {}, blurbs[runner])
    )
    button.addEventListener('click', () => {
      const now = handlers.current()
      if (now.runner === runner) return
      handlers.change({ runner, model: runner === 'claude' ? 'sonnet' : '', effort: runner === 'gemini' ? '' : now.effort })
      handlers.rebuild()
    })
    wrap.append(button)
  }
  return wrap
}

function selectOf(label: string, options: { value: string; label: string }[], current: string, disabled: boolean, onPick: (value: string) => void): HTMLSelectElement {
  const select = h('select', { class: 'text-input crew-select', 'aria-label': label, disabled })
  for (const option of options) select.append(h('option', { value: option.value }, option.label))
  select.value = current
  select.addEventListener('change', () => onPick(select.value))
  return select
}

export function previewText(member: CrewMember): string {
  const launch = { instructions: composeInstructions(member, member.runner), model: member.model, effort: member.effort, permissions: member.permissions, startup: member.startup }
  return commandPreview(member.runner, launch, member)
}

function pasteEditor(member: CrewMember, readOnly: boolean, handlers: SetupHandlers): HTMLElement {
  const wrap = h('div', { class: 'crew-paste' })
  const chips = h('div', { class: 'crew-vars' })
  member.paste.forEach((pattern, index) => {
    const chip = h('span', { class: 'crew-chip' }, `${PASTE_LABELS[pattern.kind]} → {{${pattern.field}}}`)
    if (!readOnly) {
      const remove = h('button', { class: 'crew-chip-x', type: 'button', 'aria-label': `Remove paste pattern ${PASTE_LABELS[pattern.kind]}` }, '×')
      remove.addEventListener('click', () => {
        handlers.change({ paste: handlers.current().paste.filter((_, at) => at !== index) })
        handlers.rebuild()
      })
      chip.append(remove)
    }
    chips.append(chip)
  })
  if (member.paste.length === 0) chips.append(h('span', { class: 'crew-hint' }, 'Pasting text never offers this member.'))
  wrap.append(chips)
  const fields = templateFields(member.prompt)
  if (!readOnly && fields.length > 0) {
    const kind = selectOf('Paste pattern', (Object.keys(PASTE_LABELS) as PasteKind[]).map((value) => ({ value, label: PASTE_LABELS[value] })), 'pr', false, () => undefined)
    const field = selectOf('Fills the field', fields.map((name) => ({ value: name, label: `{{${name}}}` })), fields[0], false, () => undefined)
    const add = h('button', { class: 'btn small', type: 'button' }, 'Add pattern')
    add.addEventListener('click', () => {
      const pick = kind.value as PasteKind
      handlers.change({ paste: [...handlers.current().paste.filter((p) => !(p.kind === pick && p.field === field.value)), { kind: pick, field: field.value }].slice(0, 8) })
      handlers.rebuild()
    })
    wrap.append(h('div', { class: 'crew-paste-add' }, kind, field, add))
  }
  return wrap
}

/** The Setup form for a member. Built-ins are read only: the controls show but do not change. */
export function buildSetup(member: CrewMember, handlers: SetupHandlers): HTMLElement {
  const locked = member.builtin
  const preview = h('div', { class: 'crew-cmd', 'data-crew-preview': '' }, previewText(member))
  const varsHost = h('div', {})
  varsHost.append(fieldChips(member.prompt))
  const nameInput = textInput('Name', member.name, locked, 40, (value) => {
    const now = handlers.current()
    handlers.change({ name: value, ...(now.initials === initialsOf(now.name) ? { initials: initialsOf(value) } : {}) })
    initialsInput.value = handlers.current().initials
  }, 'name')
  const roleInput = textInput('Role', member.role, locked, 60, (value) => handlers.change({ role: value }), 'role')
  const initialsInput = textInput('Initials', member.initials, locked, 3, (value) => handlers.change({ initials: value.toUpperCase() }), 'initials')
  initialsInput.classList.add('crew-initials')
  const promptArea = textArea('Prompt', member.prompt, 4, locked, true, (value) => {
    handlers.change({ prompt: value })
    clear(varsHost)
    varsHost.append(fieldChips(value))
  })
  const rows: Node[] = [
    group('Identity'),
    ...row('Name · role', h('div', { class: 'crew-idrow' }, nameInput, roleInput, initialsInput)),
    ...row('Colour', colourSwatches(member.colour, locked, (colour) => { handlers.change({ colour }); handlers.rebuild() })),
    group('Job'),
    ...row('Instructions', textArea('Instructions', member.instructions, 8, locked, true, (value) => handlers.change({ instructions: value })), locked ? 'Built in. Duplicate to change the instructions.' : member.source.linked ? 'Linked: the file wins each time this member runs.' : undefined),
    ...row('Prompt', h('div', {}, promptArea, varsHost), 'Use {{fields}} for what a run asks you for. Without any, a run asks for a task.'),
    ...row('Projects', textInput('Projects', member.projects.join(', '), locked, 200, (value) => handlers.change({ projects: value.split(',').map((p) => p.trim()).filter(Boolean) })), 'Project names, separated by commas. Empty means any project.'),
    ...row('Paste to run', pasteEditor(member, locked, handlers)),
    group('How it runs'),
    ...row('Runs on', runnerCards(member, locked, handlers)),
    ...row(
      'Model · effort',
      h(
        'div',
        { class: 'crew-idrow' },
        selectOf('Model', modelChoices(member.runner).map((value) => ({ value, label: modelLabel(member.runner, value) })), member.model, locked, (value) => { handlers.change({ model: value }); handlers.rebuild() }),
        selectOf('Effort', EFFORTS.filter((e) => member.runner !== 'gemini' || e.value === '').map((e) => ({ value: e.value, label: e.label })), member.runner === 'gemini' ? '' : member.effort, locked || member.runner === 'gemini', (value) => { handlers.change({ effort: value as CrewEffort }); handlers.rebuild() })
      ),
      member.runner === 'gemini' ? 'Gemini has no effort setting.' : undefined
    ),
    ...row(
      'Permissions',
      radios('Permissions', (Object.keys(PERMISSION_LABELS) as CrewPermissions[]).map((value) => ({ value, label: PERMISSION_LABELS[value], hint: PERMISSION_HINTS[value] })), member.permissions, locked, (value) => { handlers.change({ permissions: value }); handlers.rebuild() }),
      member.runner === 'codex' ? CODEX_SANDBOX_NOTE : undefined
    ),
    ...row(
      'Start-up',
      radios('Start-up', (Object.keys(STARTUP_LABELS) as CrewStartup[]).map((value) => ({ value, label: STARTUP_LABELS[value], hint: STARTUP_HINTS[value] })), member.startup, locked || member.runner !== 'claude', (value) => { handlers.change({ startup: value }); handlers.rebuild() }),
      member.runner === 'claude' ? undefined : 'Start-up applies to Claude Code only.'
    ),
    ...row('Command preview', preview, 'The instructions travel as an argument, never through a shell.')
  ]
  return h('div', { class: 'crew-form' }, ...rows)
}

export function refreshPreview(root: HTMLElement, member: CrewMember): void {
  const preview = root.querySelector('[data-crew-preview]')
  if (preview) preview.textContent = previewText(member)
}

