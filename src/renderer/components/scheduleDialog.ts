import { agentLabel } from '../../shared/agents'
import { buildSchedule, formatLocalInput, type ScheduleForm } from '../../shared/scheduleForm'
import { COMPARE_PROMPT_MAX } from '../../shared/compare'
import type { Project, ScheduledRun } from '../../shared/types'
import { updateSchedules } from '../automation/settings'
import { h } from '../dom'
import { newId } from '../state'
import { nextDialogId, present } from './dialogs'
import { selectMenu } from './selectMenu'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SCHEDULE_AGENTS = ['claude', 'codex'] as const

export interface ScheduleDialogOptions {
  projects: Project[]
  /** The schedule being edited; absent for a new one. */
  schedule?: ScheduledRun
  projectId: string
}

const field = (label: string, id: string, control: HTMLElement): HTMLElement =>
  h('div', { class: 'field' }, h('label', { for: id, class: 'dialog-label' }, label), control)

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function initialForm(options: ScheduleDialogOptions): ScheduleForm {
  const s = options.schedule
  return {
    name: s?.name ?? '', projectId: s?.projectId ?? options.projectId, agent: s?.agent ?? 'claude', prompt: s?.prompt ?? '',
    kind: s?.onceAt === undefined ? 'weekly' : 'once', days: s?.days.length ? s.days : [1, 2, 3, 4, 5],
    time: s ? `${pad(s.hour)}:${pad(s.minute)}` : '09:00',
    onceLocal: formatLocalInput(s?.onceAt ?? Date.now() + 60 * 60_000), worktree: s?.worktree ?? true
  }
}

function dayChecks(id: number, days: number[]): { row: HTMLElement; read: () => number[] } {
  const boxes = WEEKDAYS.map((day, index) => {
    const box = h('input', { type: 'checkbox', id: `sch-day-${id}-${index}`, checked: days.includes(index), 'aria-label': day })
    return { index, box, label: h('label', { class: 'compare-check', for: box.id }, box, day) }
  })
  return {
    row: h('div', { class: 'schedule-days', role: 'group', 'aria-label': 'Weekdays' }, ...boxes.map((item) => item.label)),
    read: () => boxes.filter((item) => item.box.checked).map((item) => item.index)
  }
}

/** Adds a schedule, or changes the one given. Resolves true once saved. */
export function scheduleDialog(options: ScheduleDialogOptions): Promise<boolean> {
  const id = nextDialogId()
  const start = initialForm(options)
  const name = h('input', { class: 'text-input', id: `sch-name-${id}`, type: 'text', value: start.name, placeholder: 'Defaults to the start of the prompt', maxlength: '120' })
  const project = h('select', { class: 'rp-project field-select', id: `sch-project-${id}` })
  for (const item of options.projects) project.append(h('option', { value: item.id }, item.name))
  project.value = start.projectId
  const agent = h('select', { class: 'rp-project field-select', id: `sch-agent-${id}` })
  for (const kind of SCHEDULE_AGENTS) agent.append(h('option', { value: kind }, agentLabel(kind)))
  agent.value = start.agent
  const prompt = h('textarea', { class: 'text-input dialog-text', id: `sch-prompt-${id}`, rows: '4', maxlength: String(COMPARE_PROMPT_MAX), spellcheck: 'false', placeholder: 'Run the test suite and fix what fails' })
  prompt.value = start.prompt
  const kind = h('select', { class: 'rp-project field-select', id: `sch-kind-${id}` }, h('option', { value: 'weekly' }, 'On weekdays'), h('option', { value: 'once' }, 'Once'))
  kind.value = start.kind
  const days = dayChecks(id, start.days)
  const time = h('input', { class: 'text-input', id: `sch-time-${id}`, type: 'time', value: start.time, 'aria-label': 'Time of day' })
  const weekly = h('div', { class: 'schedule-when' }, days.row, field('Time', time.id, time))
  const onceInput = h('input', { class: 'text-input', id: `sch-once-${id}`, type: 'datetime-local', value: start.onceLocal })
  const once = h('div', { class: 'schedule-when' }, field('Date and time', onceInput.id, onceInput))
  const worktree = h('input', { type: 'checkbox', id: `sch-worktree-${id}`, checked: start.worktree })
  const error = h('pre', { class: 'compare-error', role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const save = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, options.schedule ? 'Save schedule' : 'Add schedule')
  const showKind = (): void => { weekly.hidden = kind.value !== 'weekly'; once.hidden = kind.value !== 'once' }
  const dialog = h('div', { class: 'dialog compare-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.schedule ? 'Edit scheduled run' : 'Add scheduled run' },
    h('h2', {}, options.schedule ? 'Edit scheduled run' : 'Add scheduled run'),
    h('p', { class: 'dialog-hint' }, 'Starts an agent on a prompt at the time you choose. It only runs while Dawsha is open.'),
    field('Name', name.id, name),
    h('div', { class: 'field-row' }, field('Project', project.id, selectMenu(project)), field('Agent', agent.id, selectMenu(agent))),
    field('Prompt', prompt.id, prompt),
    field('When', kind.id, selectMenu(kind)), weekly, once,
    h('label', { class: 'compare-check', for: worktree.id }, worktree, 'Start in a new git worktree so the run does not touch your checkout'),
    error,
    h('div', { class: 'dialog-actions' }, cancel, save))
  showKind()
  kind.addEventListener('change', showKind)
  const shown = present<boolean>(dialog, false, prompt)
  cancel.addEventListener('click', () => shown.finish(false))
  save.addEventListener('click', () => {
    const built = buildSchedule({
      name: name.value, projectId: project.value, agent: agent.value as ScheduleForm['agent'], prompt: prompt.value,
      kind: kind.value as ScheduleForm['kind'], days: days.read(), time: time.value, onceLocal: onceInput.value, worktree: worktree.checked
    }, options.schedule?.id ?? newId(), options.schedule, Date.now())
    if (!built.ok) { error.textContent = built.error; error.hidden = false; return }
    updateSchedules((all) => options.schedule ? all.map((item) => (item.id === built.schedule.id ? built.schedule : item)) : [...all, built.schedule])
    shown.finish(true)
  })
  return shown.result
}
