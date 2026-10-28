import { AGENT_NAMES } from '../../shared/agents'
import type { ProjectTask, ResumeSession } from '../../shared/types'
import { resumeInNewPane, saveSettings } from '../actions'
import { api } from '../api'
import { clear, h } from '../dom'
import { store, type AppState } from '../state'
import { selectMenu } from './selectMenu'
import { confirmDialog, promptDialog } from './dialogs'

const sessionKey = (session: ResumeSession): string => `${session.agent}:${session.id}`

export class TasksPanelComponent {
  readonly el = h('div', { class: 'tasks-panel' })
  private projectId = ''
  private selectedId = ''
  private linkSessionKey = ''
  private sessions: ResumeSession[] = []
  private request = 0
  private signature = ''
  private state: AppState | null = null

  update(state: AppState): void {
    this.state = state
    if (state.projectsTab !== 'tasks') return
    if (!state.settings.projects.some((project) => project.id === this.projectId)) {
      this.projectId = state.settings.projects[0]?.id ?? ''
      void this.loadSessions()
    }
    const projectTasks = state.settings.tasks.filter((task) => task.projectId === this.projectId)
    if (!projectTasks.some((task) => task.id === this.selectedId)) this.selectedId = projectTasks[0]?.id ?? ''
    const signature = JSON.stringify([this.projectId, this.selectedId, state.settings.projects, state.settings.tasks, this.sessions])
    if (signature === this.signature) return
    this.signature = signature
    this.render()
  }

  private async loadSessions(): Promise<void> {
    const token = ++this.request
    this.sessions = []
    if (!this.projectId) return
    try {
      const sessions = await api.listAllResumable({ projectId: this.projectId, limit: 400 })
      if (token !== this.request) return
      this.sessions = sessions
    } catch { /* Keep task management available when agent transcripts cannot be read. */ }
    this.signature = ''
    this.update(store.state)
  }

  private save(tasks: ProjectTask[]): void {
    store.set((state) => ({ ...state, settings: { ...state.settings, tasks } }))
    void saveSettings({ tasks })
  }

  private edit(task: ProjectTask, patch: Partial<ProjectTask>): void {
    this.save(store.state.settings.tasks.map((item) => item.id === task.id ? { ...item, ...patch } : item))
  }

  private async add(): Promise<void> {
    if (!this.projectId) return
    const title = await promptDialog({ title: 'New task', label: 'Task name', confirmLabel: 'Create task', validate: (value) => value.trim() ? null : 'Enter a task name.' })
    if (!title) return
    const task: ProjectTask = { id: crypto.randomUUID(), projectId: this.projectId, title, note: '', createdAt: Date.now(), sessionKeys: [], events: [] }
    this.selectedId = task.id
    this.save([...store.state.settings.tasks, task])
  }

  private async remove(task: ProjectTask): Promise<void> {
    const confirmed = await confirmDialog({ title: `Delete ${task.title}?`, body: 'This removes the task history from Dawsha. Linked agent transcripts and project files stay on disk.', confirmLabel: 'Delete task' })
    if (!confirmed) return
    this.selectedId = ''
    this.save(store.state.settings.tasks.filter((item) => item.id !== task.id))
  }

  private async addEvent(task: ProjectTask, kind: 'note' | 'commit'): Promise<void> {
    const text = await promptDialog({ title: kind === 'commit' ? 'Link a commit' : 'Add a task note', label: kind === 'commit' ? 'Commit hash or URL' : 'What happened?', confirmLabel: 'Add to history', validate: (value) => value.trim() ? null : 'Enter a value.' })
    if (!text) return
    this.edit(task, { events: [...task.events, { id: crypto.randomUUID(), kind, text, at: Date.now() }] })
  }

  private render(): void {
    const state = this.state
    if (!state) return
    clear(this.el)
    const projects = state.settings.projects
    const project = projects.find((item) => item.id === this.projectId)
    const select = h('select', { class: 'text-input', 'aria-label': 'Task project' })
    for (const item of projects) select.append(h('option', { value: item.id }, item.name))
    select.value = this.projectId
    select.addEventListener('change', () => {
      this.projectId = select.value
      this.selectedId = ''
      this.linkSessionKey = ''
      this.signature = ''
      this.update(store.state)
      void this.loadSessions()
    })
    this.el.append(h('div', { class: 'tasks-head' }, h('p', { class: 'lede' }, 'Keep related sessions, notes and commits together across days.'), selectMenu(select),
      h('button', { class: 'btn primary', type: 'button', disabled: !project, onClick: () => void this.add() }, 'New task')))
    if (!project) {
      this.el.append(h('p', { class: 'proj-empty' }, 'Add a project to create tasks.'))
      return
    }
    const tasks = state.settings.tasks.filter((task) => task.projectId === project.id).sort((a, b) => b.createdAt - a.createdAt)
    const selected = tasks.find((task) => task.id === this.selectedId) ?? tasks[0]
    const list = h('div', { class: 'tasks-list' })
    for (const task of tasks) list.append(h('button', { class: `tasks-item${task.id === selected?.id ? ' selected' : ''}`, type: 'button', onClick: () => { this.selectedId = task.id; this.signature = ''; this.update(store.state) } },
      h('strong', {}, task.title), h('span', { class: 'muted' }, `${task.sessionKeys.length} linked sessions`)))
    if (tasks.length === 0) list.append(h('p', { class: 'proj-empty' }, 'No tasks in this project yet.'))
    this.el.append(h('div', { class: 'tasks-layout' }, list, selected ? this.detail(selected) : h('div', { class: 'tasks-detail' }, 'Create a task to start its history.')))
  }

  private detail(task: ProjectTask): HTMLElement {
    const note = h('textarea', { class: 'text-input', rows: 3, 'aria-label': 'Task goal', placeholder: 'What is this task trying to achieve?' }, task.note)
    note.addEventListener('change', () => this.edit(task, { note: note.value }))
    const available = this.sessions.filter((session) => !task.sessionKeys.includes(sessionKey(session)))
    const picker = h('select', { class: 'text-input', 'aria-label': 'Session to link' }, h('option', { value: '' }, 'Choose a session to link'))
    for (const session of available) picker.append(h('option', { value: sessionKey(session) }, `${AGENT_NAMES[session.agent]} · ${session.title}`))
    if (available.some((session) => sessionKey(session) === this.linkSessionKey)) picker.value = this.linkSessionKey
    else this.linkSessionKey = ''
    picker.addEventListener('change', () => { this.linkSessionKey = picker.value })
    const link = h('button', { class: 'btn ghost', type: 'button', onClick: () => {
      const key = this.linkSessionKey || picker.value
      if (!key) return
      this.linkSessionKey = ''
      this.edit(task, { sessionKeys: [...task.sessionKeys, key] })
    } }, 'Link session')
    const history = h('div', { class: 'task-history' })
    const entries: { at: number; node: HTMLElement }[] = [
      { at: task.createdAt, node: h('div', { class: 'task-event' }, h('small', {}, new Date(task.createdAt).toLocaleString()), h('p', {}, 'Task created')) }
    ]
    for (const key of task.sessionKeys) {
      const session = this.sessions.find((item) => sessionKey(item) === key)
      const label = session ? `${AGENT_NAMES[session.agent]} · ${session.title}` : `${key} (transcript unavailable)`
      entries.push({ at: session?.modifiedAt ?? task.createdAt, node: h('div', { class: 'task-event' },
        h('small', {}, session ? new Date(session.modifiedAt).toLocaleString() : 'Saved link'),
        h('p', {}, label),
        session ? h('button', { class: 'btn ghost small', type: 'button', onClick: () => void resumeInNewPane(session) }, 'Resume') : null,
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => this.edit(task, { sessionKeys: task.sessionKeys.filter((item) => item !== key) }) }, 'Unlink')) })
    }
    for (const event of task.events) entries.push({ at: event.at, node: h('div', { class: 'task-event' }, h('small', {}, new Date(event.at).toLocaleString()), h('p', {}, `${event.kind === 'commit' ? 'Commit' : 'Note'} · ${event.text}`), h('button', { class: 'btn ghost small', type: 'button', onClick: () => this.edit(task, { events: task.events.filter((item) => item.id !== event.id) }) }, 'Remove')) })
    for (const entry of entries.sort((a, b) => b.at - a.at)) history.append(entry.node)
    return h('div', { class: 'tasks-detail' },
      h('div', { class: 'tasks-head' }, h('h2', {}, task.title), h('button', { class: 'btn ghost small', type: 'button', onClick: async () => {
        const title = await promptDialog({ title: 'Rename task', label: 'Task name', initial: task.title, confirmLabel: 'Save', validate: (value) => value.trim() ? null : 'Enter a task name.' })
        if (title) this.edit(task, { title })
      } }, 'Rename'), h('button', { class: 'btn ghost small', type: 'button', onClick: () => void this.remove(task) }, 'Delete')),
      h('label', {}, 'Goal', note),
      h('div', { class: 'tasks-link' }, selectMenu(picker), link),
      h('div', { class: 'tasks-head' }, h('h3', {}, 'History'), h('button', { class: 'btn ghost small', type: 'button', onClick: () => void this.addEvent(task, 'note') }, 'Add note'), h('button', { class: 'btn ghost small', type: 'button', onClick: () => void this.addEvent(task, 'commit') }, 'Link commit')),
      history)
  }
}
