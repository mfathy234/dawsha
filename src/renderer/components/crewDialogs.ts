import {
  RUN_CHOICES,
  RUN_CHOICE_LABELS,
  PERMISSION_LABELS,
  STARTUP_LABELS,
  inScope,
  initialsOf,
  modelLabel,
  resolveRun,
  runFields,
  templateFields,
  type CrewMember,
  type CrewPermissions,
  type CrewStartup,
  type RunChoice,
  type RunWhere
} from '../../shared/crew'
import { visibleMembers } from '../../shared/crewBuiltins'
import { draftFromAgentFile, draftFromSkill, parseSourceFile, draftFromPrompt, type MemberDraft } from '../../shared/crewImport'
import { CODEX_SANDBOX_NOTE, commandPreview, composeInstructions } from '../../shared/crewLaunch'
import { matchPaste, type PasteHit } from '../../shared/crewPaste'
import type { CrewSourceFile } from '../../shared/crewSources'
import { startSession } from '../actions'
import { api } from '../api'
import { addMembers, currentMembers, runMember } from '../crewActions'
import { clear, h } from '../dom'
import { store } from '../state'
import { crewAvatar } from './crewAvatar'
import { colourSwatches } from './crewSetup'
import { nextDialogId, present } from './dialogs'
import { selectMenu } from './selectMenu'
import { toast } from './toast'
import './crew.css'

const label = (field: string): string => field.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function projectSelect(member: CrewMember | null, preferred?: string): HTMLSelectElement {
  const select = h('select', { class: 'text-input', 'aria-label': 'Project' })
  const state = store.state
  const focusedProject = state.panes.find((pane) => pane.id === state.focusedId)?.projectId
  const projects = state.settings.projects.filter((project) => !member || inScope(member, project.name))
  for (const project of projects) select.append(h('option', { value: project.id }, project.name))
  const wanted = [preferred, focusedProject].find((id) => id && projects.some((p) => p.id === id))
  if (wanted) select.value = wanted
  return select
}

export function previewFor(member: CrewMember, choice: RunChoice): string {
  const { runner, model } = resolveRun(member, choice)
  return commandPreview(
    runner,
    { instructions: composeInstructions(member, runner), model, effort: runner === member.runner ? member.effort : '', permissions: member.permissions, startup: member.startup },
    member
  )
}

function choiceChip(text: string, value: string, checked: boolean): HTMLElement {
  return h('button', { class: 'crew-chip-btn', type: 'button', role: 'radio', 'aria-checked': String(checked), 'data-value': value }, text)
}

export interface RunPreset {
  fields?: Record<string, string>
  projectId?: string
}

export async function openRunDialog(member: CrewMember, preset: RunPreset = {}): Promise<void> {
  const id = nextDialogId()
  const fields = runFields(member)
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>()
  const grid = h('div', { class: 'crew-dlg-grid' })
  for (const field of fields) {
    const long = field === 'task' || field === 'goal'
    const input = long
      ? h('textarea', { class: 'text-input crew-area', id: `crew-field-${id}-${field}`, rows: '3', 'aria-label': label(field) })
      : h('input', { class: 'text-input', id: `crew-field-${id}-${field}`, type: 'text', autocomplete: 'off', 'aria-label': label(field) })
    input.value = preset.fields?.[field] ?? ''
    inputs.set(field, input)
    grid.append(h('label', { for: input.id }, label(field)), input)
  }
  const project = projectSelect(member, preset.projectId)
  project.id = `crew-project-${id}`
  grid.append(h('label', { for: project.id }, 'Project'), selectMenu(project))
  let choice: RunChoice = 'default'
  let where: RunWhere = 'pane'
  const chips = h('div', { class: 'crew-chips', role: 'radiogroup', 'aria-label': 'Model for this run' })
  const memberDefault = `${member.runner === 'claude' ? 'Claude' : member.runner === 'codex' ? 'Codex' : 'Gemini'} · ${modelLabel(member.runner, member.model)}`
  for (const value of RUN_CHOICES) {
    const chip = choiceChip(value === 'default' ? `Member default · ${memberDefault}` : RUN_CHOICE_LABELS[value], value, value === choice)
    chip.addEventListener('click', () => {
      choice = value
      update()
    })
    chips.append(chip)
  }
  grid.append(h('label', {}, 'Model'), chips)
  const whereGroup = h('div', { class: 'crew-seg', role: 'radiogroup', 'aria-label': 'Where' })
  for (const [value, text] of [['pane', 'New pane'], ['background', 'Background']] as const) {
    const button = h('button', { class: 'crew-seg-btn', type: 'button', role: 'radio', 'aria-checked': String(value === where), 'data-where': value }, text)
    button.addEventListener('click', () => {
      where = value
      update()
    })
    whereGroup.append(button)
  }
  grid.append(h('label', {}, 'Where'), whereGroup)
  const preview = h('div', { class: 'crew-cmd', 'data-crew-run-preview': '' })
  const note = h('p', { class: 'crew-note', hidden: true })
  const geminiWarn = h('div', { class: 'crew-warn', role: 'alert', hidden: true, 'data-gemini-warning': '' })
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const go = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '', id: 'crew-run-go' }, `Run ${member.name}`)
  const dialog = h(
    'div',
    { class: 'dialog crew-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Run ${member.name}` },
    h('div', { class: 'crew-dlg-head' }, crewAvatar(member, 'idle', 36), h('div', {}, h('h2', {}, `Run ${member.name}`), h('div', { class: 'crew-muted' }, member.role))),
    grid,
    preview,
    note,
    geminiWarn,
    error,
    h('div', { class: 'dialog-actions crew-dlg-actions' }, h('span', { class: 'crew-hint-line' }, where === 'pane' ? 'Runs in a pane in the project above · Ctrl+Enter' : ''), cancel, go)
  )
  const hint = dialog.querySelector('.crew-hint-line') as HTMLElement
  let geminiOut = false
  const update = (): void => {
    for (const chip of chips.querySelectorAll('button')) chip.setAttribute('aria-checked', String(chip.getAttribute('data-value') === choice))
    for (const button of whereGroup.querySelectorAll('button')) button.setAttribute('aria-checked', String(button.getAttribute('data-where') === where))
    const { runner } = resolveRun(member, choice)
    preview.textContent = previewFor(member, choice)
    note.hidden = runner !== 'codex'
    note.textContent = runner === 'codex' ? CODEX_SANDBOX_NOTE : ''
    hint.textContent = where === 'pane' ? 'Runs in a pane in the project above · Ctrl+Enter' : 'Starts without taking focus · Ctrl+Enter'
    const blocked = runner === 'gemini' && geminiOut
    geminiWarn.hidden = !blocked
    go.disabled = blocked
  }
  geminiWarn.append(
    h('span', {}, 'Gemini is not signed in on this PC. '),
    h('button', { class: 'link-quiet', type: 'button', id: 'crew-gemini-signin' }, 'Open a Gemini session to sign in')
  )
  const first = [...inputs.values()][0] ?? project
  const shown = present<boolean>(dialog, false, first)
  geminiWarn.querySelector('button')!.addEventListener('click', () => {
    shown.finish(false)
    if (project.value) void startSession(project.value, 'gemini')
  })
  cancel.addEventListener('click', () => shown.finish(false))
  const submit = async (): Promise<void> => {
    error.hidden = true
    go.disabled = true
    const values = Object.fromEntries([...inputs].map(([key, input]) => [key, input.value]))
    const result = await runMember({ member, projectId: project.value, choice, fields: values, background: where === 'background' })
    if (!result.ok) {
      error.textContent = result.error
      error.hidden = false
      update()
      return
    }
    shown.finish(true)
    if (where === 'background') toast(`${member.name} started in the background.`, 'info')
  }
  go.addEventListener('click', () => void submit())
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !go.disabled) {
      event.preventDefault()
      void submit()
    }
  })
  update()
  void api.agentAccounts().then(
    (accounts) => {
      geminiOut = accounts.gemini.kind === 'none'
      update()
    },
    () => undefined
  )
  await shown.result
}

interface Suggestion {
  hit: PasteHit | null
  text: string
}

export function openHandDialog(): void {
  const members = visibleMembers(store.state.settings.crew).filter((member) => !member.lead)
  const area = h('textarea', { class: 'text-input crew-area crew-paste-box', rows: '3', placeholder: 'Paste an id, a PR link or a build link', 'aria-label': 'What to hand over', spellcheck: 'false' })
  const project = projectSelect(null)
  project.setAttribute('aria-label', 'Project')
  const list = h('div', { class: 'crew-hand-list', role: 'listbox', 'aria-label': 'Suggested members' })
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const dialog = h(
    'div',
    { class: 'dialog crew-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hand a job to an agent' },
    h('h2', {}, 'Hand a job to an agent'),
    h('p', { class: 'dialog-hint' }, 'Paste what you have. Dawsha suggests who should take it and fills in the fields. Enter runs the first suggestion.'),
    area,
    h('div', { class: 'crew-dlg-grid crew-hand-project' }, h('label', {}, 'Project'), selectMenu(project)),
    list,
    error,
    h('div', { class: 'dialog-actions' }, cancel)
  )
  const shown = present<void>(dialog, undefined, area)
  let suggestions: Suggestion[] = []
  let active = 0
  const draw = (): void => {
    clear(list)
    suggestions.forEach((suggestion, index) => {
      const hit = suggestion.hit
      const row = h(
        'button',
        { class: `crew-hand-row${index === active ? ' active' : ''}`, type: 'button', role: 'option', 'aria-selected': String(index === active), 'data-hand': hit ? hit.member.id : 'plain' },
        hit ? crewAvatar(hit.member, 'idle', 28) : h('span', { class: 'crew-hand-plain' }, '>_'),
        h('span', { class: 'crew-hand-main' }, hit ? h('b', {}, hit.member.name) : h('b', {}, 'New session with this text'), hit ? h('span', { class: 'crew-muted' }, ` · ${hit.member.role}`) : null),
        h('span', { class: 'crew-muted crew-hand-why' }, hit ? hit.why : 'Starts a normal session and sends the text')
      )
      row.addEventListener('click', () => void choose(suggestion))
      list.append(row)
    })
  }
  const refresh = (): void => {
    const text = area.value
    const hits = matchPaste(text, members).slice(0, 4)
    suggestions = [...hits.map((hit): Suggestion => ({ hit, text })), ...(text.trim() !== '' ? [{ hit: null, text }] : [])]
    active = 0
    draw()
  }
  const choose = async (suggestion: Suggestion): Promise<void> => {
    error.hidden = true
    if (!project.value) {
      error.textContent = 'Add a project first.'
      error.hidden = false
      return
    }
    if (!suggestion.hit) {
      shown.finish()
      await startSession(project.value, undefined, undefined, false, undefined, undefined, suggestion.text)
      return
    }
    const { member, fields } = suggestion.hit
    const missing = runFields(member).filter((name) => (fields[name] ?? '').trim() === '')
    shown.finish()
    if (missing.length > 0) {
      await openRunDialog(member, { fields, projectId: project.value })
      return
    }
    const result = await runMember({ member, projectId: project.value, choice: 'default', fields, background: false })
    if (!result.ok) toast(result.error)
  }
  area.addEventListener('input', refresh)
  area.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return
      event.preventDefault()
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length
      draw()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const pick = suggestions[active]
      if (pick) void choose(pick)
    }
  })
  cancel.addEventListener('click', () => shown.finish())
  void shown.result
}

interface Candidate {
  source: CrewSourceFile
  draft: MemberDraft
  linked: boolean
}

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path
const sameFile = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

function takenOf(extra: readonly CrewMember[]): { names: string[]; colours: CrewMember['colour'][] } {
  const all = [...currentMembers(), ...extra]
  return { names: all.map((m) => m.name), colours: all.map((m) => m.colour) }
}

export function draftFor(source: CrewSourceFile, taken: ReturnType<typeof takenOf>, projectNames: string[]): MemberDraft {
  const parsed = parseSourceFile(source.fileName, source.text)
  if (source.kind === 'skill') {
    return draftFromSkill({ name: parsed.name, description: parsed.description, body: parsed.body, path: source.path, agent: source.agent }, taken, projectNames)
  }
  if (source.kind === 'prompt') return draftFromPrompt(parsed, source.path, taken)
  return draftFromAgentFile(parsed, source.path, taken, projectNames)
}

function candidatesOf(files: CrewSourceFile[]): Candidate[] {
  const projectNames = store.state.settings.projects.map((p) => p.name)
  const existing = currentMembers().filter((m) => m.source.path !== '')
  const taken = takenOf([])
  const found: Candidate[] = []
  for (const source of files) {
    const linked = existing.some((member) => sameFile(member.source.path, source.path))
    const draft = draftFor(source, taken, projectNames)
    taken.names.push(draft.member.name)
    taken.colours.push(draft.member.colour)
    found.push({ source, draft, linked })
  }
  return found
}

export async function openImportDialog(): Promise<CrewMember[]> {
  const list = h('div', { class: 'crew-import-list' }, h('p', { class: 'crew-muted' }, 'Looking for agents, skills and Codex prompts…'))
  const filter = h('input', { class: 'text-input', type: 'search', placeholder: 'Filter by name or path', 'aria-label': 'Filter what was found' })
  const status = h('span', { class: 'crew-hint-line', role: 'status' })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const go = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '', id: 'crew-import-go', disabled: true }, 'Import')
  const dialog = h(
    'div',
    { class: 'dialog crew-dialog crew-import', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Import agents' },
    h('h2', {}, 'Import agents'),
    h('p', { class: 'dialog-hint' }, 'Dawsha found these on this PC. Each stays linked to its file, which is only read, never changed.'),
    filter,
    list,
    h('div', { class: 'dialog-actions crew-dlg-actions' }, status, cancel, go)
  )
  const shown = present<CrewMember[]>(dialog, [], filter)
  cancel.addEventListener('click', () => shown.finish([]))
  let candidates: Candidate[] = []
  const picked = new Set<Candidate>()
  const names = new Map<Candidate, HTMLInputElement>()
  const draw = (): void => {
    clear(list)
    const query = filter.value.trim().toLowerCase()
    const groups: [string, Candidate['source']['kind']][] = [['Agents', 'agent'], ['Codex prompts', 'prompt'], ['Skills', 'skill']]
    let any = false
    for (const [title, kind] of groups) {
      const rows = candidates.filter((c) => c.source.kind === kind && (query === '' || `${c.draft.member.name} ${c.source.fileName} ${c.source.path}`.toLowerCase().includes(query)))
      if (rows.length === 0) continue
      any = true
      list.append(h('div', { class: 'crew-sec' }, h('span', {}, title), h('span', {}, String(rows.length))))
      for (const candidate of rows) list.append(importRow(candidate))
    }
    if (!any) list.append(h('p', { class: 'crew-muted' }, candidates.length === 0 ? 'Nothing found in ~/.claude/agents, your skills or ~/.codex/prompts.' : 'Nothing matches that filter.'))
    count()
  }
  const count = (): void => {
    go.disabled = picked.size === 0
    go.textContent = picked.size === 0 ? 'Import' : `Import ${picked.size}`
  }
  const importRow = (candidate: Candidate): HTMLElement => {
    const { member } = candidate.draft
    const box = h('input', { type: 'checkbox', 'aria-label': `Import ${member.name} from ${candidate.source.fileName}`, disabled: candidate.linked })
    box.checked = picked.has(candidate)
    box.addEventListener('change', () => {
      if (box.checked) picked.add(candidate)
      else picked.delete(candidate)
      count()
    })
    const name = names.get(candidate) ?? h('input', { class: 'text-input crew-import-name', type: 'text', 'aria-label': `Name for ${candidate.source.fileName}`, maxlength: '40' })
    if (!names.has(candidate)) {
      name.value = member.name
      names.set(candidate, name)
    }
    return h(
      'div',
      { class: `crew-import-row${candidate.linked ? ' is-linked' : ''}`, 'data-source': candidate.source.fileName },
      box,
      crewAvatar(member, 'idle', 28),
      h('div', { class: 'crew-import-main' }, h('div', { class: 'crew-import-line' }, name, h('span', { class: 'crew-muted' }, member.role)), h('div', { class: 'crew-muted crew-import-path', title: candidate.source.path }, candidate.linked ? 'Already in your crew' : `${basename(candidate.source.path)} · ${candidate.source.scope}${candidate.source.project ? ` · ${basename(candidate.source.project)}` : ''}`))
    )
  }
  filter.addEventListener('input', draw)
  go.addEventListener('click', () => {
    const chosen = [...picked].map((candidate) => {
      const typed = names.get(candidate)?.value.trim() || candidate.draft.member.name
      const base = candidate.draft.member
      return { ...base, name: typed, initials: typed === base.name ? base.initials : initialsOf(typed) }
    })
    shown.finish(addMembers(chosen))
  })
  try {
    candidates = candidatesOf(await api.crewSources())
    for (const candidate of candidates) if (!candidate.linked && candidate.source.kind !== 'skill') picked.add(candidate)
    status.textContent = `${candidates.length} found`
  } catch {
    status.textContent = 'Could not scan this PC.'
  }
  draw()
  return shown.result
}

const TERMS = /(correlation[ -]?id|trace[ -]?id|request[ -]?id|\bdev\b|\bstage\b|\buat\b|\bpreprod\b|read[- ]only|\bPRs?\b|pull[ -]request|build (?:url|link|id)|\burl\b)/gi

function highlighted(text: string, projectNames: string[]): HTMLElement {
  const pre = h('pre', { class: 'crew-skill-src' })
  const escaped = projectNames.filter((n) => n.length >= 3).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`${TERMS.source}${escaped.length > 0 ? `|\\b(?:${escaped.join('|')})\\b` : ''}`, 'gi')
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) pre.append(text.slice(last, at))
    pre.append(h('mark', {}, match[0]))
    last = at + match[0].length
  }
  pre.append(text.slice(last))
  return pre
}

const MODEL_CHOICES: { value: string; label: string }[] = [
  { value: 'sonnet', label: 'Claude · Sonnet' },
  { value: 'opus', label: 'Claude · Opus' },
  { value: 'fable', label: 'Claude · Fable' },
  { value: 'haiku', label: 'Claude · Haiku' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' }
]

function why(text: string): HTMLElement {
  return h('div', { class: 'crew-why' }, text)
}

function convertForm(draft: MemberDraft): { el: HTMLElement; member: () => CrewMember } {
  let member = draft.member
  const avatarHost = h('span', {})
  const refreshAvatar = (): void => {
    avatarHost.replaceChildren(crewAvatar(member, 'idle', 32))
  }
  refreshAvatar()
  const nameInput = h('input', { class: 'text-input', type: 'text', 'aria-label': 'Name', maxlength: '40', style: 'width:150px' })
  nameInput.value = member.name
  const roleInput = h('input', { class: 'text-input', type: 'text', 'aria-label': 'Role', maxlength: '60' })
  roleInput.value = member.role
  nameInput.addEventListener('input', () => {
    member = { ...member, name: nameInput.value, initials: initialsOf(nameInput.value) }
    refreshAvatar()
  })
  roleInput.addEventListener('input', () => {
    member = { ...member, role: roleInput.value }
  })
  const swatches = h('div', {})
  const drawSwatches = (): void => {
    swatches.replaceChildren(
      colourSwatches(member.colour, false, (colour) => {
        member = { ...member, colour }
        drawSwatches()
        refreshAvatar()
      })
    )
  }
  drawSwatches()
  const vars = h('div', { class: 'crew-vars' })
  const drawVars = (): void => {
    const fields = templateFields(member.prompt)
    vars.replaceChildren(...(fields.length > 0 ? fields.map((f) => h('code', {}, `{{${f}}}`)) : [h('span', { class: 'crew-hint' }, 'None. A run asks for a task.')]))
  }
  drawVars()
  const prompt = h('textarea', { class: 'text-input crew-area mono', rows: '2', 'aria-label': 'Prompt' })
  prompt.value = member.prompt
  prompt.addEventListener('input', () => {
    member = { ...member, prompt: prompt.value }
    drawVars()
  })
  const instructions = h('textarea', { class: 'text-input crew-area mono', rows: '3', 'aria-label': 'Instructions' })
  instructions.value = member.instructions
  instructions.addEventListener('input', () => {
    member = { ...member, instructions: instructions.value }
  })
  const radioGroup = <T extends string>(labelText: string, options: [T, string][], get: () => T, set: (value: T) => void): HTMLElement => {
    const wrap = h('div', { class: 'crew-chips', role: 'radiogroup', 'aria-label': labelText })
    const draw = (): void => {
      wrap.replaceChildren(
        ...options.map(([value, text]) => {
          const chip = choiceChip(text, value, get() === value)
          chip.addEventListener('click', () => {
            set(value)
            draw()
          })
          return chip
        })
      )
    }
    draw()
    return wrap
  }
  const permissions = radioGroup<CrewPermissions>('Permissions', (Object.keys(PERMISSION_LABELS) as CrewPermissions[]).map((v) => [v, PERMISSION_LABELS[v]]), () => member.permissions, (permissionsValue) => {
    member = { ...member, permissions: permissionsValue }
  })
  const modelKey = (): string => (member.runner === 'claude' ? member.model : member.runner)
  const models = radioGroup<string>('Model', MODEL_CHOICES.map((c) => [c.value, c.label]), modelKey, (value) => {
    member = value === 'codex' || value === 'gemini' ? { ...member, runner: value, model: '', effort: '' } : { ...member, runner: 'claude', model: value }
  })
  const startup = radioGroup<CrewStartup>('Start-up', (Object.keys(STARTUP_LABELS) as CrewStartup[]).map((v) => [v, STARTUP_LABELS[v]]), () => member.startup, (value) => {
    member = { ...member, startup: value }
  })
  const paste = h('div', { class: 'crew-vars' })
  const drawPaste = (): void => {
    paste.replaceChildren(...(member.paste.length > 0 ? member.paste.map((p) => h('code', {}, `${p.kind}${p.envField ? ' + env' : ''} → {{${p.field}}}`)) : [h('span', { class: 'crew-hint' }, 'Nothing to recognise.')]))
  }
  drawPaste()
  const projects = h('input', { class: 'text-input', type: 'text', 'aria-label': 'Projects', placeholder: 'Any project' })
  projects.value = member.projects.join(', ')
  projects.addEventListener('input', () => {
    member = { ...member, projects: projects.value.split(',').map((p) => p.trim()).filter(Boolean) }
  })
  const rowOf = (text: string, control: Node, reason: string): Node[] => [h('label', { class: 'crew-label' }, text), h('div', { class: 'crew-control' }, control, why(reason))]
  const el = h(
    'div',
    { class: 'crew-conv-form' },
    ...rowOf('Who', h('div', { class: 'crew-idrow' }, avatarHost, nameInput, roleInput), draft.why.who),
    ...rowOf('Colour', swatches, 'Picked from the skill name'),
    ...rowOf('Asks you for', vars, draft.why.fields),
    ...rowOf('Prompt', prompt, draft.why.prompt),
    ...rowOf('Instructions', instructions, draft.why.instructions),
    ...rowOf('Permissions', permissions, draft.why.permissions),
    ...rowOf('Model', models, 'Sonnet unless you pick another'),
    ...rowOf('Start-up', startup, draft.why.startup),
    ...rowOf('Paste to run', paste, draft.why.paste),
    ...rowOf('Projects', projects, draft.why.projects)
  )
  return { el, member: () => member }
}

/** The Skills page's "Make a crew member": one dialog per skill, each filled in from the skill and editable before it is saved. */
export async function openConvertDialog(ids: string[]): Promise<CrewMember[]> {
  if (ids.length === 0) return []
  let files: CrewSourceFile[]
  try {
    files = await api.crewSources(ids)
  } catch {
    toast('Could not read that skill.')
    return []
  }
  const projectNames = store.state.settings.projects.map((p) => p.name)
  const added: CrewMember[] = []
  for (let index = 0; index < files.length; index += 1) {
    const source = files[index]
    const taken = takenOf(added)
    const draft = draftFor(source, taken, projectNames)
    const titleName = source.fileName
    const keep = h('input', { type: 'checkbox', id: 'crew-keep-linked', checked: true })
    const form = convertForm(draft)
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, files.length > 1 ? 'Skip' : 'Cancel')
    const add = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '', id: 'crew-convert-go' }, `Add ${draft.member.name}`)
    const source$ = h('div', {}, h('h3', {}, `The ${source.kind === 'skill' ? 'skill' : 'agent'} · ${source.path}`), highlighted(source.text.slice(0, 2400), projectNames))
    const dialog = h(
      'div',
      { class: 'dialog crew-dialog crew-convert', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Make an agent from ${titleName}` },
      h('h2', {}, `Make an agent from ${titleName}${files.length > 1 ? ` (${index + 1} of ${files.length})` : ''}`),
      h('p', { class: 'dialog-hint' }, 'Dawsha reads it and fills in a member. Check it, change anything, then save.'),
      h('div', { class: 'crew-conv' }, source$, h('div', {}, h('h3', {}, 'The agent'), form.el)),
      h('div', { class: 'dialog-actions crew-dlg-actions' }, h('label', { class: 'crew-keep' }, keep, ` Keep it linked: when the ${source.kind === 'skill' ? 'skill' : 'agent'} changes, the member follows`), cancel, add)
    )
    const shown = present<boolean>(dialog, false, add)
    cancel.addEventListener('click', () => shown.finish(false))
    const nameField = dialog.querySelector<HTMLInputElement>('input[aria-label="Name"]')
    nameField?.addEventListener('input', () => {
      add.textContent = `Add ${nameField.value.trim() || 'agent'}`
    })
    add.addEventListener('click', () => shown.finish(true))
    if (await shown.result) {
      const member = form.member()
      const [saved] = addMembers([{ ...member, name: member.name.trim() || draft.member.name, source: { ...member.source, linked: keep.checked } }])
      added.push(saved)
    } else if (files.length === 1) {
      return []
    }
  }
  return added
}

