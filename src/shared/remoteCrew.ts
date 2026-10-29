import { FIELD_VALUE_MAX, RUN_CHOICES, inScope, isColour, isRunChoice, missingFields, runFields, type CrewColour, type CrewMember, type RunChoice } from './crew'
import { AVATAR_LABELS, type AvatarState } from './crewLive'
import type { Project } from './types'

export interface RemoteCrewMember {
  id: string
  name: string
  role: string
  initials: string
  colour: CrewColour
  fields: string[]
  models: RunChoice[]
  projects: string[]
  state: AvatarState
}

export interface RemoteCrewJob {
  runId: string
  memberId: string
  name: string
  initials: string
  colour: CrewColour
  task: string
  state: AvatarState
  line: string
  termId: string
}

export interface RemoteCrewGoal {
  title: string
  state: AvatarState
  line: string
}

export interface RemoteCrewSnapshot {
  states: Record<string, AvatarState>
  jobs: RemoteCrewJob[]
  goal: RemoteCrewGoal | null
}

export interface RemoteCrewPayload {
  members: RemoteCrewMember[]
  jobs: RemoteCrewJob[]
  goal: RemoteCrewGoal | null
}

export interface RemoteRunRequest {
  member: CrewMember
  project: Project
  choice: RunChoice
  fields: Record<string, string>
}

export type RemoteRunCheck = { ok: true; request: RemoteRunRequest } | { ok: false; error: string }

export const emptyCrewSnapshot = (): RemoteCrewSnapshot => ({ states: {}, jobs: [], goal: null })

const MAX_FIELDS = 24
const MAX_JOBS = 12
const STATES: readonly AvatarState[] = ['idle', 'working', 'needs', 'done', 'failed']
const isState = (value: unknown): value is AvatarState => STATES.includes(value as AvatarState)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

export const JOB_LINES: Record<AvatarState, string> = {
  idle: 'Waiting to start',
  working: 'Working on it',
  needs: 'Waiting for you. Answer it in Needs you or on the PC',
  done: 'Finished',
  failed: 'Stopped with an error'
}

export const runnable = (member: CrewMember): boolean => !member.hidden && !member.lead

/** What the phone may see of the crew: names, colours, fields and live state. Never instructions, prompts or file paths. */
export function remoteCrewPayload(members: readonly CrewMember[], snapshot: RemoteCrewSnapshot): RemoteCrewPayload {
  return {
    members: members.filter(runnable).map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      initials: member.initials,
      colour: member.colour,
      fields: runFields(member),
      models: [...RUN_CHOICES],
      projects: [...member.projects],
      state: snapshot.states[member.id] ?? 'idle'
    })),
    jobs: snapshot.jobs,
    goal: snapshot.goal
  }
}

/** Reads a snapshot sent by the desktop window and keeps only what the phone shows, so a bad value cannot reach the phone. */
export function sanitizeCrewSnapshot(value: unknown): RemoteCrewSnapshot {
  if (!isRecord(value)) return emptyCrewSnapshot()
  const states: Record<string, AvatarState> = {}
  if (isRecord(value.states)) {
    for (const [id, state] of Object.entries(value.states).slice(0, 200)) if (isState(state)) states[id.slice(0, 60)] = state
  }
  const jobs = (Array.isArray(value.jobs) ? value.jobs : []).slice(0, MAX_JOBS).flatMap((item): RemoteCrewJob[] => {
    if (!isRecord(item) || !isState(item.state)) return []
    const runId = clip(item.runId, 20)
    const name = clip(item.name, 40)
    if (runId === '' || name === '') return []
    return [{
      runId,
      memberId: clip(item.memberId, 60),
      name,
      initials: clip(item.initials, 3),
      colour: isColour(item.colour) ? item.colour : 'blue',
      task: clip(item.task, 120),
      state: item.state,
      line: JOB_LINES[item.state],
      termId: clip(item.termId, 128)
    }]
  })
  const goal = isRecord(value.goal) && isState(value.goal.state)
    ? { title: clip(value.goal.title, 120), state: value.goal.state, line: JOB_LINES[value.goal.state] }
    : null
  return { states, jobs, goal: goal && goal.title !== '' ? goal : null }
}

export function checkRemoteRun(input: unknown, members: readonly CrewMember[], projects: readonly Project[]): RemoteRunCheck {
  if (!isRecord(input)) return { ok: false, error: 'Invalid run request.' }
  if (Object.keys(input).some((key) => !['member', 'project', 'model', 'fields'].includes(key))) return { ok: false, error: 'Invalid run request.' }
  if (typeof input.member !== 'string' || typeof input.project !== 'string') return { ok: false, error: 'Choose an agent and a project.' }
  const choice = input.model === undefined ? 'default' : input.model
  if (!isRunChoice(choice)) return { ok: false, error: 'That model is not available.' }
  const member = members.find((candidate) => candidate.id === input.member)
  if (!member || !runnable(member)) return { ok: false, error: 'That agent is not available.' }
  const project = projects.find((candidate) => candidate.id === input.project)
  if (!project) return { ok: false, error: 'Choose a project to run in.' }
  if (!inScope(member, project.name)) return { ok: false, error: `${member.name} is limited to ${member.projects.join(', ')}.` }
  const raw = input.fields === undefined ? {} : input.fields
  if (!isRecord(raw) || Object.keys(raw).length > MAX_FIELDS) return { ok: false, error: 'Invalid fields.' }
  const known = runFields(member)
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!known.includes(key)) return { ok: false, error: `${member.name} has no field ${key}.` }
    if (typeof value !== 'string' || value.length > FIELD_VALUE_MAX) return { ok: false, error: `Field ${key} is too long.` }
    fields[key] = value
  }
  const missing = missingFields(member, fields)
  if (missing.length > 0) return { ok: false, error: `Fill in ${missing.join(', ')} first.` }
  return { ok: true, request: { member, project, choice, fields } }
}

export const jobStateWord = (state: AvatarState): string => AVATAR_LABELS[state]
