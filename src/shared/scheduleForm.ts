import type { AgentKind, ScheduledRun } from './types'

export interface ScheduleForm {
  name: string
  projectId: string
  agent: Extract<AgentKind, 'claude' | 'codex'>
  prompt: string
  kind: 'weekly' | 'once'
  days: number[]
  /** "HH:mm" */
  time: string
  /** "YYYY-MM-DDTHH:mm" in local time, as a datetime-local input holds it. */
  onceLocal: string
  worktree: boolean
}

export type ScheduleBuild = { ok: true; schedule: ScheduledRun } | { ok: false; error: string }

const NAME_MAX = 40
const pad = (value: number): string => String(value).padStart(2, '0')

export function formatLocalInput(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultName(prompt: string): string {
  const line = prompt.split('\n')[0].trim()
  return line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 3)}...` : line
}

function parseTime(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour <= 23 && minute <= 59 ? { hour, minute } : null
}

/** Checks the form and returns the schedule it describes; an edit keeps its run history, and its check clock restarts at now. */
export function buildSchedule(form: ScheduleForm, id: string, existing: ScheduledRun | undefined, now: number): ScheduleBuild {
  const prompt = form.prompt.trim()
  if (prompt === '') return { ok: false, error: 'Enter the prompt to send.' }
  const common = {
    id, name: form.name.trim() || defaultName(prompt), projectId: form.projectId, agent: form.agent, prompt,
    worktree: form.worktree, lastCheckedAt: now, runs: existing?.runs ?? [],
    ...(existing?.lastRunAt === undefined ? {} : { lastRunAt: existing.lastRunAt })
  }
  if (form.kind === 'once') {
    const at = new Date(form.onceLocal).getTime()
    if (!form.onceLocal || Number.isNaN(at)) return { ok: false, error: 'Choose the date and time to run.' }
    if (at <= now) return { ok: false, error: 'Choose a time in the future.' }
    return { ok: true, schedule: { ...common, days: [], hour: 0, minute: 0, onceAt: at } }
  }
  const time = parseTime(form.time)
  if (!time) return { ok: false, error: 'Choose the time of day.' }
  if (form.days.length === 0) return { ok: false, error: 'Choose at least one weekday.' }
  return { ok: true, schedule: { ...common, days: [...new Set(form.days)].sort((a, b) => a - b), ...time } }
}
