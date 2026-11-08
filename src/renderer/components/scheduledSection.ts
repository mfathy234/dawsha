import { agentLabel } from '../../shared/agents'
import { describeSchedule, scheduleNextRun } from '../../shared/schedules'
import type { ScheduledRun } from '../../shared/types'
import { updateSchedules } from '../automation/settings'
import { h } from '../dom'
import { projectById, store } from '../state'
import { automationRow, paneLink, preview, spacer, whenText } from './automationRows'
import { confirmDialog } from './dialogs'
import { scheduleDialog } from './scheduleDialog'

function openDialog(schedule?: ScheduledRun): void {
  const { projects } = store.state.settings
  if (projects.length === 0) return
  void scheduleDialog({ projects, schedule, projectId: schedule?.projectId ?? projects[0].id })
}

async function removeSchedule(schedule: ScheduledRun): Promise<void> {
  const confirmed = await confirmDialog({
    title: `Delete the schedule "${schedule.name}"?`,
    body: `"${schedule.name}" will no longer run. Sessions it already started are not closed.`,
    confirmLabel: `Delete ${schedule.name}`,
    danger: true
  })
  if (confirmed) updateSchedules((all) => all.filter((item) => item.id !== schedule.id))
}

function lastRunLine(schedule: ScheduledRun): (Node | string)[] {
  const last = schedule.runs[0]
  if (!last) return ['Last run: none yet']
  const status = last.status === 'failed' ? `failed${last.error ? `, ${last.error}` : ''}` : 'started'
  return [`Last run: ${whenText(last.at)}, ${status} `, paneLink(last.paneId, `Open the pane of ${schedule.name}`) ?? '']
}

function scheduleRow(schedule: ScheduledRun): HTMLElement {
  const project = projectById(store.state, schedule.projectId)
  const next = scheduleNextRun(schedule, Date.now())
  const lastLine = h('span', {}, ...lastRunLine(schedule))
  return automationRow(schedule.id, [
    h('strong', { class: 'work-ticket-name' }, schedule.name),
    h('span', { class: 'work-chip' }, `${project?.name ?? 'Missing project'} · ${agentLabel(schedule.agent)}`),
    spacer(),
    h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Edit ${schedule.name}`, onClick: () => openDialog(schedule) }, 'Edit'),
    h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Delete ${schedule.name}`, onClick: () => void removeSchedule(schedule) }, 'Delete')
  ], [
    preview(schedule.prompt),
    `${describeSchedule(schedule)} · ${schedule.worktree ? 'new worktree' : 'in the project folder'} · Next run: ${next === null ? 'none' : whenText(next)}`,
    lastLine
  ])
}

/** The Scheduled section of the Work view: every scheduled run with its next and last run. */
export function scheduledSection(): HTMLElement {
  const { scheduledRuns, projects } = store.state.settings
  const list = scheduledRuns.length
    ? h('ul', { class: 'work-items', id: 'schedule-list' }, ...scheduledRuns.map(scheduleRow))
    : h('p', { class: 'usage-empty' }, projects.length ? 'Nothing is scheduled. Add a run to start an agent on a prompt at a set time.' : 'Add a project first, then schedule runs for it.')
  return h('section', { class: 'usage-panel', id: 'schedule-section', 'aria-label': 'Scheduled' },
    h('div', { class: 'usage-panel-head' }, h('h2', {}, 'Scheduled'), spacer(),
      h('button', { class: 'btn small', type: 'button', id: 'schedule-add', disabled: projects.length === 0, onClick: () => openDialog() }, 'Add scheduled run')),
    list,
    h('p', { class: 'usage-local muted' }, 'Runs only while Dawsha is open.'))
}
