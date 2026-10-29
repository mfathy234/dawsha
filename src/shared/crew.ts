import { isAgent } from './agents'
import type { AgentKind } from './types'

export const CREW_COLOURS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const
export type CrewColour = (typeof CREW_COLOURS)[number]

export type CrewPermissions = 'read' | 'ask' | 'full'
export type CrewStartup = 'lean' | 'some' | 'usual'
export type CrewEffort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type CrewSourceKind = 'dawsha' | 'agent' | 'skill' | 'prompt'
export type PasteKind = 'guid' | 'pr' | 'build' | 'url'
export type RunChoice = 'default' | 'fable' | 'opus' | 'sonnet' | 'haiku' | 'codex' | 'gemini'
export type RunWhere = 'pane' | 'background'

export interface CrewSource {
  kind: CrewSourceKind
  path: string
  linked: boolean
}

export interface PastePattern {
  kind: PasteKind
  field: string
  envField?: string
}

export interface CrewMember {
  id: string
  name: string
  role: string
  initials: string
  colour: CrewColour
  builtin: boolean
  hidden: boolean
  lead: boolean
  source: CrewSource
  description: string
  instructions: string
  prompt: string
  runner: AgentKind
  model: string
  effort: CrewEffort
  permissions: CrewPermissions
  startup: CrewStartup
  projects: string[]
  paste: PastePattern[]
}

export interface CrewSettings {
  members: CrewMember[]
  hidden: string[]
}

export type CrewOutcome = 'running' | 'done' | 'failed' | 'closed'

export interface CrewRun {
  id: string
  memberId: string
  memberName: string
  projectId: string
  projectName: string
  title: string
  runner: AgentKind
  model: string
  startedAt: number
  endedAt: number | null
  outcome: CrewOutcome
  costUsd: number | null
  paneId: string
  termId: string
  /** The Lead's goal this run belongs to. */
  goalId?: string
  /** True for the Lead's own session. */
  lead?: boolean
}

export interface CrewIdentity {
  runId: string
  memberId: string
  name: string
  role: string
  initials: string
  colour: CrewColour
  lead: boolean
}

export interface CrewLaunch {
  instructions: string
  model: string
  effort: CrewEffort
  permissions: CrewPermissions
  startup: CrewStartup
  /** Claude tool rules that run without asking, for example Bash(dawsha crew:*). */
  allow?: string
  /** The goal a Lead pane works for. The pane gets it as DAWSHA_CREW_GOAL, so `dawsha crew run` can hold it to that goal. */
  goal?: string
}

export const MAX_CREW_RUNS = 100
export const MAX_CREW_MEMBERS = 100
export const INSTRUCTIONS_MAX = 8000
export const PROMPT_MAX = 4000
export const FIELD_VALUE_MAX = 4000

export const PERMISSION_LABELS: Record<CrewPermissions, string> = { read: 'Read only', ask: 'Ask before changes', full: 'Full access' }
export const STARTUP_LABELS: Record<CrewStartup, string> = { lean: 'Lean', some: 'Some MCP servers', usual: 'Usual' }

export const RUN_CHOICES: readonly RunChoice[] = ['default', 'fable', 'opus', 'sonnet', 'haiku', 'codex', 'gemini']

export const RUN_CHOICE_LABELS: Record<RunChoice, string> = {
  default: 'Member default',
  fable: 'Claude · Fable',
  opus: 'Claude · Opus',
  sonnet: 'Claude · Sonnet',
  haiku: 'Claude · Haiku',
  codex: 'Codex',
  gemini: 'Gemini'
}

export const CLAUDE_MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const
export const CODEX_MODELS = ['', 'gpt-5.6', 'gpt-5.6-sol'] as const
export const GEMINI_MODELS = ['', 'gemini-2.5-pro', 'gemini-2.5-flash'] as const

export const modelChoices = (runner: AgentKind): readonly string[] =>
  runner === 'claude' ? CLAUDE_MODELS : runner === 'codex' ? CODEX_MODELS : GEMINI_MODELS

export const modelLabel = (runner: AgentKind, model: string): string =>
  model === '' ? 'default' : runner === 'claude' ? model[0].toUpperCase() + model.slice(1) : model

export const isRunChoice = (value: unknown): value is RunChoice => RUN_CHOICES.includes(value as RunChoice)

export const isColour = (value: unknown): value is CrewColour => CREW_COLOURS.includes(value as CrewColour)

const isPermissions = (value: unknown): value is CrewPermissions => value === 'read' || value === 'ask' || value === 'full'
const isStartup = (value: unknown): value is CrewStartup => value === 'lean' || value === 'some' || value === 'usual'
const isEffort = (value: unknown): value is CrewEffort => ['', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value as string)
const isSourceKind = (value: unknown): value is CrewSourceKind => value === 'dawsha' || value === 'agent' || value === 'skill' || value === 'prompt'
const isPasteKind = (value: unknown): value is PasteKind => value === 'guid' || value === 'pr' || value === 'build' || value === 'url'

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number, fallback = ''): string => (typeof value === 'string' ? value.slice(0, max) : fallback)

export function initialsOf(name: string): string {
  const letters = name.replace(/[^\p{L}\p{N} ]/gu, '').trim()
  if (letters === '') return '??'
  const words = letters.split(/\s+/)
  const pair = words.length > 1 ? words[0][0] + words[1][0] : letters.slice(0, 2)
  return pair.toUpperCase()
}

export function modelFits(runner: AgentKind, model: string): boolean {
  if (model === '') return runner !== 'claude'
  if (runner === 'claude') return (CLAUDE_MODELS as readonly string[]).includes(model) || /^claude-[\w.-]{1,60}$/.test(model)
  return /^[\w.:-]{1,60}$/.test(model)
}

function sanitizePaste(value: unknown): PastePattern[] {
  if (!Array.isArray(value)) return []
  const out: PastePattern[] = []
  for (const item of value.slice(0, 8)) {
    if (!isRecord(item) || !isPasteKind(item.kind)) continue
    const field = text(item.field, 40).trim()
    if (!/^\w+$/.test(field)) continue
    const envField = text(item.envField, 40).trim()
    out.push({ kind: item.kind, field, ...(/^\w+$/.test(envField) ? { envField } : {}) })
  }
  return out
}

function sanitizeSource(value: unknown): CrewSource {
  if (!isRecord(value) || !isSourceKind(value.kind) || value.kind === 'dawsha') return { kind: 'dawsha', path: '', linked: false }
  const path = text(value.path, 600)
  return path === '' ? { kind: 'dawsha', path: '', linked: false } : { kind: value.kind, path, linked: value.linked === true }
}

export function sanitizeMember(value: unknown, usedIds: Set<string> = new Set()): CrewMember | null {
  if (!isRecord(value)) return null
  const name = text(value.name, 40).trim()
  if (name === '') return null
  const id = text(value.id, 60).replace(/[^\w.-]/g, '')
  if (id === '' || usedIds.has(id)) return null
  const runner: AgentKind = isAgent(value.runner) ? value.runner : 'claude'
  const model = typeof value.model === 'string' && modelFits(runner, value.model) ? value.model : runner === 'claude' ? 'sonnet' : ''
  const initials = text(value.initials, 3).trim().toUpperCase()
  return {
    id,
    name,
    role: text(value.role, 60).trim(),
    initials: initials === '' ? initialsOf(name) : initials,
    colour: isColour(value.colour) ? value.colour : 'blue',
    builtin: false,
    hidden: false,
    lead: false,
    source: sanitizeSource(value.source),
    description: text(value.description, 400).trim(),
    instructions: text(value.instructions, INSTRUCTIONS_MAX),
    prompt: text(value.prompt, PROMPT_MAX),
    runner,
    model,
    effort: isEffort(value.effort) ? value.effort : '',
    permissions: isPermissions(value.permissions) ? value.permissions : 'ask',
    startup: isStartup(value.startup) ? value.startup : 'lean',
    projects: Array.isArray(value.projects)
      ? value.projects.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim().slice(0, 80)).slice(0, 20)
      : [],
    paste: sanitizePaste(value.paste)
  }
}

export const defaultCrew = (): CrewSettings => ({ members: [], hidden: [] })

export function sanitizeCrew(value: unknown, builtinIds: readonly string[]): CrewSettings {
  if (!isRecord(value)) return defaultCrew()
  const used = new Set<string>(builtinIds)
  const members: CrewMember[] = []
  if (Array.isArray(value.members)) {
    for (const item of value.members.slice(0, MAX_CREW_MEMBERS)) {
      const member = sanitizeMember(item, used)
      if (!member) continue
      used.add(member.id)
      members.push(member)
    }
  }
  const hidden = Array.isArray(value.hidden)
    ? [...new Set(value.hidden.filter((id): id is string => typeof id === 'string' && builtinIds.includes(id)))]
    : []
  return { members, hidden }
}

const OUTCOMES: readonly CrewOutcome[] = ['running', 'done', 'failed', 'closed']

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export function sanitizeCrewRuns(value: unknown): CrewRun[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const runs: CrewRun[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = text(item.id, 20).replace(/[^\w-]/g, '')
    if (id === '' || seen.has(id) || !isAgent(item.runner)) continue
    seen.add(id)
    const goalId = text(item.goalId, 20).replace(/[^\w-]/g, '')
    runs.push({
      id,
      memberId: text(item.memberId, 60),
      memberName: text(item.memberName, 40),
      projectId: text(item.projectId, 80),
      projectName: text(item.projectName, 80),
      title: text(item.title, 120),
      runner: item.runner,
      model: text(item.model, 60),
      startedAt: finite(item.startedAt) ?? 0,
      endedAt: finite(item.endedAt),
      outcome: OUTCOMES.includes(item.outcome as CrewOutcome) ? (item.outcome as CrewOutcome) : 'closed',
      costUsd: finite(item.costUsd),
      paneId: text(item.paneId, 80),
      termId: text(item.termId, 80),
      ...(goalId !== '' ? { goalId } : {}),
      ...(item.lead === true ? { lead: true } : {})
    })
  }
  return keepRuns(runs.sort((a, b) => b.startedAt - a.startedAt))
}

/** Keeps the newest MAX_CREW_RUNS runs, but never a run of a goal whose Lead is still working, so that goal's spend stays counted. */
export function keepRuns(runs: readonly CrewRun[]): CrewRun[] {
  const active = new Set(runs.filter((run) => run.lead && run.outcome === 'running' && run.goalId).map((run) => run.goalId))
  const held = (run: CrewRun): boolean => run.goalId !== undefined && active.has(run.goalId)
  const rest = runs.filter((run) => !held(run))
  const room = new Set(rest.slice(0, Math.max(0, MAX_CREW_RUNS - (runs.length - rest.length))))
  return runs.filter((run) => held(run) || room.has(run))
}

export function sanitizeIdentity(value: unknown): CrewIdentity | undefined {
  if (!isRecord(value)) return undefined
  const name = text(value.name, 40).trim()
  const runId = text(value.runId, 20).replace(/[^\w-]/g, '')
  if (name === '' || runId === '') return undefined
  return {
    runId,
    memberId: text(value.memberId, 60),
    name,
    role: text(value.role, 60),
    initials: text(value.initials, 3).trim().toUpperCase() || initialsOf(name),
    colour: isColour(value.colour) ? value.colour : 'blue',
    lead: value.lead === true
  }
}

export function identityOf(member: CrewMember, runId: string): CrewIdentity {
  return { runId, memberId: member.id, name: member.name, role: member.role, initials: member.initials, colour: member.colour, lead: member.lead }
}

const FIELD = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g

export function templateFields(prompt: string): string[] {
  const names: string[] = []
  for (const match of prompt.matchAll(FIELD)) if (!names.includes(match[1])) names.push(match[1])
  return names
}

/** The prompt a run sends. A member without {{fields}} gets one free "task" field, so a run always has something to say. */
export function effectiveTemplate(prompt: string): string {
  const trimmed = prompt.trim()
  if (templateFields(trimmed).length > 0) return trimmed
  return trimmed === '' ? '{{task}}' : `${trimmed}\n\n{{task}}`
}

export const runFields = (member: Pick<CrewMember, 'prompt'>): string[] => templateFields(effectiveTemplate(member.prompt))

export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(FIELD, (_all, name: string) => (values[name] ?? '').trim()).trim()
}

export const buildPrompt = (member: Pick<CrewMember, 'prompt'>, values: Readonly<Record<string, string>>): string =>
  fillTemplate(effectiveTemplate(member.prompt), values)

export function missingFields(member: Pick<CrewMember, 'prompt'>, values: Readonly<Record<string, string>>): string[] {
  return runFields(member).filter((name) => (values[name] ?? '').trim() === '')
}

const TITLE_MAX = 48

function titleValue(field: string, value: string): string {
  const line = value.trim().split(/\r?\n/)[0].trim()
  if (/^\d+$/.test(line) && /pr|pull/i.test(field)) return `PR ${line}`
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

export function runTitle(member: Pick<CrewMember, 'name' | 'prompt'>, values: Readonly<Record<string, string>>): string {
  for (const field of runFields(member)) {
    const value = titleValue(field, values[field] ?? '')
    if (value !== '') return `${member.name} · ${value}`
  }
  return member.name
}

export function resolveRun(member: Pick<CrewMember, 'runner' | 'model'>, choice: RunChoice): { runner: AgentKind; model: string } {
  if (choice === 'default') return { runner: member.runner, model: member.model }
  if (choice === 'codex') return { runner: 'codex', model: member.runner === 'codex' ? member.model : '' }
  if (choice === 'gemini') return { runner: 'gemini', model: member.runner === 'gemini' ? member.model : '' }
  return { runner: 'claude', model: choice }
}

export function findMember(members: readonly CrewMember[], query: string): CrewMember | undefined {
  const wanted = query.trim().toLowerCase()
  return members.find((m) => m.id.toLowerCase() === wanted) ?? members.find((m) => m.name.toLowerCase() === wanted)
}

export function uniqueMemberId(members: readonly Pick<CrewMember, 'id'>[], name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member'
  const used = new Set(members.map((m) => m.id))
  if (!used.has(base)) return base
  for (let n = 2; ; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

export function nextColour(members: readonly Pick<CrewMember, 'colour'>[]): CrewColour {
  const counts = new Map<CrewColour, number>(CREW_COLOURS.map((c) => [c, 0]))
  for (const m of members) counts.set(m.colour, (counts.get(m.colour) ?? 0) + 1)
  return [...CREW_COLOURS].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0]
}

export function blankMember(members: readonly CrewMember[], name = 'New member'): CrewMember {
  return {
    id: uniqueMemberId(members, name),
    name,
    role: '',
    initials: initialsOf(name),
    colour: nextColour(members),
    builtin: false,
    hidden: false,
    lead: false,
    source: { kind: 'dawsha', path: '', linked: false },
    description: '',
    instructions: '',
    prompt: '',
    runner: 'claude',
    model: 'sonnet',
    effort: '',
    permissions: 'ask',
    startup: 'lean',
    projects: [],
    paste: []
  }
}

export function duplicateMember(source: CrewMember, members: readonly CrewMember[]): CrewMember {
  const used = new Set(members.map((m) => m.name.toLowerCase()))
  let name = `${source.name} 2`
  for (let n = 3; used.has(name.toLowerCase()); n += 1) name = `${source.name} ${n}`
  return {
    ...source,
    id: uniqueMemberId(members, name),
    name,
    builtin: false,
    hidden: false,
    lead: false,
    source: source.builtin ? { kind: 'dawsha', path: '', linked: false } : source.source
  }
}

export function matchesQuery(member: CrewMember, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || [member.name, member.role, member.description].some((part) => part.toLowerCase().includes(q))
}

export function inScope(member: Pick<CrewMember, 'projects'>, projectName: string): boolean {
  return member.projects.length === 0 || member.projects.some((p) => p.toLowerCase() === projectName.toLowerCase())
}

export function isCrewLaunch(value: unknown): value is CrewLaunch {
  return (
    isRecord(value) &&
    typeof value.instructions === 'string' &&
    typeof value.model === 'string' &&
    isEffort(value.effort) &&
    isPermissions(value.permissions) &&
    isStartup(value.startup) &&
    (value.allow === undefined || (typeof value.allow === 'string' && value.allow.length <= 200))
  )
}
