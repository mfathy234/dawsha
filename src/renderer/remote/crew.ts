import { AVATAR_BADGES, AVATAR_LABELS, type AvatarState } from '../../shared/crewLive'
import type { CrewColour, RunChoice } from '../../shared/crew'
import type { RemoteCrewGoal, RemoteCrewJob, RemoteCrewMember, RemoteCrewPayload } from '../../shared/remoteCrew'
import '../components/crewAvatar.css'

export interface CrewHost {
  request<T>(path: string, init?: RequestInit): Promise<T>
  projects(): Array<{ id: string; name: string }>
  fullOutput(): boolean
  openTerminal(id: string): void
  onUnpaired(): void
}

export const CREW_OFF_MESSAGE = 'Running agents from the phone is off. Turn it on in Remote Access on your PC.'
const POLL_MS = 4000
const CHOICE_LABELS: Record<RunChoice, string> = { default: 'Default', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', codex: 'Codex', gemini: 'Gemini' }
const EMPTY: RemoteCrewPayload = { members: [], jobs: [], goal: null }

interface Draft { fields: Record<string, string>; project: string; model: RunChoice }

let host: CrewHost
let root: HTMLElement
let enabled = false
let visible = false
let loaded = false
let payload: RemoteCrewPayload = EMPTY
let selected: string | null = null
let openJob: string | null = null
let busy = false
let message = ''
let messageIsError = false
let timer = 0
let signature = ''
const drafts = new Map<string, Draft>()

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

export function avatar(identity: { name: string; initials: string; colour: CrewColour }, state: AvatarState, size: number): HTMLElement {
  const element = make('span', 'crew-av', identity.initials)
  element.style.setProperty('--c', `var(--id-${identity.colour})`)
  element.style.setProperty('--size', `${size}px`)
  element.dataset.state = state
  element.setAttribute('role', 'img')
  element.setAttribute('aria-label', `${identity.name}, ${AVATAR_LABELS[state]}`)
  const badge = make('span', 'crew-av-badge', AVATAR_BADGES[state])
  badge.setAttribute('aria-hidden', 'true')
  element.append(badge)
  return element
}

const fieldLabel = (name: string): string => {
  const words = name.replace(/[_-]+/g, ' ').trim()
  if (words === '') return name
  return words.length <= 3 ? words.toUpperCase() : words[0].toUpperCase() + words.slice(1)
}

const memberOf = (id: string | null): RemoteCrewMember | undefined => payload.members.find((member) => member.id === id)

function projectsFor(member: RemoteCrewMember): Array<{ id: string; name: string }> {
  const all = host.projects()
  if (member.projects.length === 0) return all
  const allowed = new Set(member.projects.map((name) => name.toLowerCase()))
  return all.filter((project) => allowed.has(project.name.toLowerCase()))
}

function draftOf(member: RemoteCrewMember): Draft {
  const existing = drafts.get(member.id)
  const projects = projectsFor(member)
  if (existing) {
    if (!projects.some((project) => project.id === existing.project)) existing.project = projects[0]?.id ?? ''
    return existing
  }
  const draft: Draft = { fields: {}, project: projects[0]?.id ?? '', model: 'default' }
  drafts.set(member.id, draft)
  return draft
}

function setMessage(text: string, isError = false): void {
  message = text
  messageIsError = isError
}

function gridView(): HTMLElement {
  const grid = make('div', 'pc-grid')
  grid.setAttribute('role', 'group')
  grid.setAttribute('aria-label', 'Agents')
  for (const member of payload.members) {
    const item = make('button', 'pc-member')
    item.type = 'button'
    item.id = `crew-member-${member.id}`
    item.setAttribute('aria-pressed', String(selected === member.id))
    item.append(avatar(member, member.state, 44), make('span', 'pc-name', member.name))
    if (member.state !== 'idle') item.append(make('span', `pc-state pc-${member.state}`, AVATAR_LABELS[member.state]))
    item.addEventListener('click', () => {
      selected = selected === member.id ? null : member.id
      setMessage('')
      render(true)
    })
    grid.append(item)
  }
  return grid
}

function cardView(): HTMLElement | null {
  const member = memberOf(selected)
  if (!member) return null
  const draft = draftOf(member)
  const projects = projectsFor(member)
  const card = make('section', 'pc-card')
  card.id = 'crew-run-card'
  card.setAttribute('aria-label', `Run ${member.name}`)
  const who = make('div', 'pc-who')
  const text = make('span')
  text.append(make('b', '', `Run ${member.name}`))
  if (member.role) text.append(make('small', '', member.role))
  who.append(avatar(member, member.state, 40), text)
  card.append(who)

  const fields = make('div', 'pc-fields')
  for (const name of member.fields) {
    const label = make('label', 'pc-field')
    const id = `crew-field-${name}`
    label.htmlFor = id
    label.append(make('span', '', fieldLabel(name)))
    const input = name === 'task' ? make('textarea') : make('input')
    if (input instanceof HTMLInputElement) input.type = 'text'
    if (input instanceof HTMLTextAreaElement) input.rows = 2
    input.id = id
    input.maxLength = 4000
    input.value = draft.fields[name] ?? ''
    input.autocomplete = 'off'
    input.addEventListener('input', () => { draft.fields[name] = input.value })
    label.append(input)
    fields.append(label)
  }
  const projectLabel = make('label', 'pc-field')
  projectLabel.htmlFor = 'crew-project'
  projectLabel.append(make('span', '', 'Project'))
  const select = make('select')
  select.id = 'crew-project'
  select.append(...projects.map((project) => {
    const option = make('option', '', project.name)
    option.value = project.id
    return option
  }))
  select.value = draft.project
  select.addEventListener('change', () => { draft.project = select.value })
  projectLabel.append(select)
  fields.append(projectLabel)
  card.append(fields)

  const chips = make('div', 'pc-chips')
  chips.setAttribute('role', 'radiogroup')
  chips.setAttribute('aria-label', 'Model')
  for (const choice of member.models) {
    const chip = make('button', 'pc-chip', CHOICE_LABELS[choice])
    chip.type = 'button'
    chip.setAttribute('role', 'radio')
    chip.setAttribute('aria-checked', String(draft.model === choice))
    chip.dataset.model = choice
    chip.addEventListener('click', () => {
      draft.model = choice
      for (const other of chips.querySelectorAll<HTMLElement>('.pc-chip')) other.setAttribute('aria-checked', String(other === chip))
    })
    chips.append(chip)
  }
  card.append(chips)

  const run = make('button', 'pc-run', busy ? 'Starting…' : `Run ${member.name}`)
  run.type = 'button'
  run.id = 'crew-run'
  run.disabled = busy || projects.length === 0
  run.addEventListener('click', () => void start(member))
  card.append(run)
  if (projects.length === 0) card.append(make('p', 'pc-note', `${member.name} has no matching project on this PC.`))
  if (message) {
    const note = make('p', messageIsError ? 'pc-note pc-error' : 'pc-note', message)
    note.setAttribute('role', messageIsError ? 'alert' : 'status')
    card.append(note)
  }
  return card
}

function jobRow(job: RemoteCrewJob): HTMLElement {
  const row = make('div', 'pc-job')
  const open = openJob === job.runId
  const head = make('button', 'pc-job-head')
  head.type = 'button'
  head.setAttribute('aria-expanded', String(open))
  head.dataset.run = job.runId
  const title = make('span', 'pc-job-title')
  title.append(make('b', '', job.task ? `${job.name} · ${job.task}` : job.name))
  title.append(make('small', '', job.line))
  head.append(avatar(job, job.state, 36), title, make('span', `pc-job-state pc-${job.state}`, AVATAR_LABELS[job.state]))
  head.addEventListener('click', () => {
    openJob = open ? null : job.runId
    render(true)
  })
  row.append(head)
  if (open) {
    const detail = make('div', 'pc-job-detail')
    detail.append(make('p', '', `${job.line}.`))
    if (host.fullOutput() && job.termId) {
      const see = make('button', 'pc-quiet', 'Read the output')
      see.type = 'button'
      see.addEventListener('click', () => host.openTerminal(job.termId))
      detail.append(see)
    } else {
      detail.append(make('p', 'pc-note', 'Full output is off. Turn it on in Remote Access on your PC to read it here.'))
    }
    row.append(detail)
  }
  return row
}

function goalRow(goal: RemoteCrewGoal): HTMLElement {
  const row = make('div', 'pc-job pc-goal')
  const head = make('div', 'pc-job-head')
  const title = make('span', 'pc-job-title')
  title.append(make('b', '', goal.title), make('small', '', goal.line))
  head.append(title, make('span', `pc-job-state pc-${goal.state}`, AVATAR_LABELS[goal.state]))
  row.append(head)
  return row
}

function jobsView(): HTMLElement | null {
  if (payload.jobs.length === 0 && !payload.goal) return null
  const section = make('section', 'pc-jobs')
  section.id = 'crew-jobs'
  section.append(make('h2', '', 'On a job'))
  if (payload.goal) section.append(goalRow(payload.goal))
  for (const job of payload.jobs) section.append(jobRow(job))
  return section
}

function render(force = false): void {
  if (!enabled) {
    signature = ''
    const off = make('p', 'pc-off', CREW_OFF_MESSAGE)
    off.id = 'crew-off'
    root.replaceChildren(off)
    return
  }
  const next = JSON.stringify([payload, selected, openJob, busy, message, host.fullOutput(), host.projects()])
  if (!force && next === signature) return
  signature = next
  const heading = make('div', 'pc-heading')
  heading.append(make('h1', '', 'Agents'), make('p', 'view-description', 'Hand a job to someone. It runs on your PC, in the project you pick.'))
  const parts: Array<HTMLElement | null> = [heading]
  if (loaded && payload.members.length === 0) parts.push(make('p', 'quiet-empty', 'No agents are ready to run. Add one in Agents on your PC.'))
  else {
    parts.push(gridView(), cardView())
    if (!selected && message) {
      const done = make('p', 'pc-note pc-done', message)
      done.id = 'crew-done'
      done.setAttribute('role', 'status')
      parts.push(done)
    }
    parts.push(jobsView())
  }
  const active = document.activeElement
  const keep = active instanceof HTMLElement && root.contains(active) ? active.id : ''
  root.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null))
  if (keep) document.getElementById(keep)?.focus()
}

async function start(member: RemoteCrewMember): Promise<void> {
  if (busy) return
  const draft = draftOf(member)
  busy = true
  setMessage('')
  render(true)
  try {
    await host.request<{ runId: string }>('crew/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member: member.id, project: draft.project, model: draft.model, fields: draft.fields })
    })
    drafts.delete(member.id)
    selected = null
    busy = false
    setMessage(`${member.name} started on your PC.`)
    await refresh()
    render(true)
  } catch (error) {
    busy = false
    setMessage(error instanceof Error ? error.message : 'Could not start the run.', true)
    render(true)
  }
}

export async function refresh(): Promise<void> {
  if (!enabled) return
  try {
    const next = await host.request<RemoteCrewPayload>('crew')
    if (!next || !Array.isArray(next.members) || !Array.isArray(next.jobs)) return
    payload = next
    loaded = true
    if (selected && !memberOf(selected)) selected = null
    render()
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) host.onUnpaired()
    else if (status === 403) { enabled = false; render() }
  }
}

function poll(): void {
  window.clearInterval(timer)
  timer = 0
  if (!enabled || !visible) return
  timer = window.setInterval(() => { if (!document.hidden) void refresh() }, POLL_MS)
}

export function setCrewEnabled(value: boolean): void {
  if (value === enabled) return
  enabled = value
  if (!value) { payload = EMPTY; loaded = false; selected = null; openJob = null }
  render(true)
  if (value && visible) void refresh()
  poll()
}

export function setCrewVisible(value: boolean): void {
  if (value === visible) return
  visible = value
  if (value) { render(true); void refresh() }
  poll()
}

export function initCrew(options: { root: HTMLElement; host: CrewHost }): void {
  root = options.root
  host = options.host
  render(true)
}
