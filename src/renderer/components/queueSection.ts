import { agentLabel } from '../../shared/agents'
import { moveQueueTask } from '../../shared/taskQueue'
import type { Project, QueuedPrompt } from '../../shared/types'
import { isQueueActive, startQueue, stopQueue } from '../automation/queueRunner'
import { saveAutomation, updateQueue } from '../automation/settings'
import { h } from '../dom'
import { store } from '../state'
import { automationRow, paneLink, preview, spacer } from './automationRows'
import { confirmDialog } from './dialogs'
import { queueTaskDialog } from './queueTaskDialog'
import { selectMenu } from './selectMenu'

const STATE_LABEL: Record<QueuedPrompt['state'], string> = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed' }
const MAX_PARALLEL = 5
let chosenProjectId: string | null = null

function currentProject(projects: readonly Project[]): Project | null {
  return projects.find((project) => project.id === chosenProjectId) ?? projects[0] ?? null
}

async function removeTask(task: QueuedPrompt): Promise<void> {
  const confirmed = await confirmDialog({
    title: `Remove "${task.name}" from the queue?`,
    body: `"${task.name}" will be taken off the queue. A session it already started is not closed.`,
    confirmLabel: `Remove ${task.name}`,
    danger: true
  })
  if (confirmed) updateQueue((all) => all.filter((item) => item.id !== task.id))
}

function moveTask(task: QueuedPrompt, delta: -1 | 1): void {
  updateQueue((all) => {
    const own = all.filter((item) => item.projectId === task.projectId)
    const moved = moveQueueTask(own, task.id, delta)
    let next = 0
    return all.map((item) => (item.projectId === task.projectId ? moved[next++] : item))
  })
}

function taskRow(task: QueuedPrompt, index: number, count: number): HTMLElement {
  const agent = task.agent ?? store.state.settings.queueAgent
  const movable = task.state === 'queued'
  return automationRow(task.id, [
    h('span', { class: 'work-chip', 'data-state': task.state }, STATE_LABEL[task.state]),
    h('strong', { class: 'work-ticket-name' }, task.name),
    spacer(),
    paneLink(task.paneId, `Open the pane of ${task.name}`),
    h('button', { class: 'btn ghost small', type: 'button', disabled: !movable || index === 0, 'aria-label': `Move ${task.name} up`, onClick: () => moveTask(task, -1) }, 'Up'),
    h('button', { class: 'btn ghost small', type: 'button', disabled: !movable || index === count - 1, 'aria-label': `Move ${task.name} down`, onClick: () => moveTask(task, 1) }, 'Down'),
    h('button', { class: 'btn ghost small', type: 'button', disabled: task.state === 'running', 'aria-label': `Remove ${task.name}`, onClick: () => void removeTask(task) }, 'Remove')
  ], [`${agentLabel(agent)} · ${preview(task.prompt)}`, task.error ?? null])
}

function numberSelect(value: number, max: number, onPick: (n: number) => void): HTMLElement {
  const select = h('select', { class: 'rp-project field-select', id: 'queue-parallel', 'aria-label': 'Sessions at a time' })
  for (let n = 1; n <= max; n += 1) select.append(h('option', { value: String(n) }, String(n)))
  select.value = String(value)
  select.addEventListener('change', () => onPick(Number(select.value)))
  return selectMenu(select)
}

function agentSelect(value: string): HTMLElement {
  const select = h('select', { class: 'rp-project field-select', id: 'queue-agent', 'aria-label': 'Agent for new tasks' })
  for (const kind of ['claude', 'codex'] as const) select.append(h('option', { value: kind }, agentLabel(kind)))
  select.value = value
  select.addEventListener('change', () => saveAutomation({ queueAgent: select.value === 'codex' ? 'codex' : 'claude' }))
  return selectMenu(select)
}

function projectSelect(projects: readonly Project[], project: Project): HTMLElement {
  const select = h('select', { class: 'rp-project field-select', id: 'queue-project', 'aria-label': 'Queue project' })
  for (const item of projects) select.append(h('option', { value: item.id }, item.name))
  select.value = project.id
  select.addEventListener('change', () => { chosenProjectId = select.value; store.set((state) => ({ ...state })) })
  return selectMenu(select)
}

function controls(project: Project, tasks: QueuedPrompt[]): HTMLElement {
  const { queueAgent, queueConcurrency } = store.state.settings
  const active = isQueueActive(project.id)
  const waiting = tasks.some((task) => task.state === 'queued')
  return h('div', { class: 'queue-controls' },
    h('button', { class: 'btn small', type: 'button', id: 'queue-add', onClick: () => void queueTaskDialog(project) }, 'Add task'),
    active
      ? h('button', { class: 'btn small', type: 'button', id: 'queue-stop', onClick: () => stopQueue(project.id) }, 'Stop queue')
      : h('button', { class: 'btn primary small', type: 'button', id: 'queue-start', disabled: !waiting, onClick: () => startQueue(project.id) }, 'Start queue'),
    h('label', { class: 'queue-setting' }, 'Agent', agentSelect(queueAgent)),
    h('label', { class: 'queue-setting' }, 'At a time', numberSelect(queueConcurrency, MAX_PARALLEL, (n) => saveAutomation({ queueConcurrency: n }))))
}

/** Changes whenever what the queue section shows, beyond the saved settings, changes. */
export const queueViewKey = (): string => `${chosenProjectId}|${store.state.settings.projects.map((project) => isQueueActive(project.id)).join()}`

/** The Task queue section of the Work view: prompts for one project, run a few at a time each in its own worktree. */
export function queueSection(): HTMLElement {
  const { projects, queuedPrompts } = store.state.settings
  const project = currentProject(projects)
  if (!project) {
    return h('section', { class: 'usage-panel', id: 'queue-section', 'aria-label': 'Task queue' }, h('h2', {}, 'Task queue'),
      h('p', { class: 'usage-empty' }, 'Add a project first, then queue prompts for it.'))
  }
  const tasks = queuedPrompts.filter((task) => task.projectId === project.id)
  const list = tasks.length
    ? h('ul', { class: 'work-items', id: 'queue-list' }, ...tasks.map((task, index) => taskRow(task, index, tasks.length)))
    : h('p', { class: 'usage-empty' }, 'The queue is empty. Add prompts and start the queue to work through them.')
  return h('section', { class: 'usage-panel', id: 'queue-section', 'aria-label': 'Task queue' },
    h('div', { class: 'usage-panel-head' }, h('h2', {}, 'Task queue'), spacer(), projectSelect(projects, project)),
    controls(project, tasks),
    list,
    h('p', { class: 'usage-local muted' }, 'Each task runs in its own worktree. When a session goes idle after working, or exits, the next task starts.'))
}
