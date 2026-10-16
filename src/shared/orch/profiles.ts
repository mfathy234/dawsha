import { ORCH_ROLES, type OrchRole } from './types'
import type { ModelPrice, PriceLookup } from './usage'

export const ORCH_RUNNERS = ['claude', 'codex', 'gemini'] as const
export type OrchRunner = (typeof ORCH_RUNNERS)[number]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** One way to run a role: which CLI, model and effort. `model: ''` means the CLI's own default. */
export interface OrchProfile {
  id: string
  name: string
  role: OrchRole
  runner: OrchRunner
  model: string
  effort: Effort | null
  /** Codex only: run the model locally through Ollama (`--oss`). Always priced as free. */
  local: boolean
  /** Extra instructions added to the role's built-in prompt. */
  prompt: string
}

/** A team: which profile fills each role, plus the run's stops and limits. Null = no agent for the role. */
export interface OrchPlan {
  id: string
  name: string
  builtIn: boolean
  roles: Partial<Record<OrchRole, string | null>>
  /** Stop for the human to approve the spec and mockups before building. */
  specApproval: boolean
  maxWorkers: number
  taskMinutes: number
}

export interface OrchSettings {
  profiles: OrchProfile[]
  plans: OrchPlan[]
  defaultPlanId: string
  /** USD per million tokens, keyed `runner:model`. */
  prices: Record<string, ModelPrice>
}

export const DEFAULT_PLAN_ID = 'default'
export const MAX_WORKERS_LIMIT = 5
const MIN_TASK_MINUTES = 5
const MAX_TASK_MINUTES = 240

const profile = (id: string, name: string, role: OrchRole, runner: OrchRunner, model: string, effort: Effort | null): OrchProfile =>
  ({ id, name, role, runner, model, effort, local: false, prompt: '' })

// Model names are CLI aliases or '' (the CLI's configured default), so nothing here goes stale.
const DEFAULT_PROFILES: readonly OrchProfile[] = [
  profile('p-lead', 'Lead', 'lead', 'claude', 'opus', 'high'),
  profile('p-spec-writer', 'Spec writer', 'spec-writer', 'claude', 'sonnet', 'medium'),
  profile('p-implementer', 'Implementer', 'implementer', 'codex', '', 'medium'),
  profile('p-ui', 'UI builder', 'ui', 'claude', 'sonnet', 'medium'),
  profile('p-code-reviewer', 'Code reviewer', 'code-reviewer', 'claude', 'sonnet', 'high'),
  profile('p-ux-reviewer', 'UX reviewer', 'ux-reviewer', 'gemini', '', null),
  profile('p-tester', 'Tester', 'tester', 'claude', 'haiku', 'low'),
  profile('p-lead-budget', 'Lead (budget)', 'lead', 'claude', 'sonnet', 'medium'),
  profile('p-implementer-budget', 'Implementer (budget)', 'implementer', 'codex', '', 'low'),
  profile('p-code-reviewer-budget', 'Code reviewer (budget)', 'code-reviewer', 'claude', 'haiku', 'medium'),
  profile('p-tester-budget', 'Tester (budget)', 'tester', 'gemini', '', null)
]

const DEFAULT_PLANS: readonly OrchPlan[] = [
  {
    id: DEFAULT_PLAN_ID,
    name: 'Default',
    builtIn: true,
    roles: {
      lead: 'p-lead', 'spec-writer': 'p-spec-writer', implementer: 'p-implementer', ui: 'p-ui',
      'code-reviewer': 'p-code-reviewer', 'ux-reviewer': 'p-ux-reviewer', tester: 'p-tester', fixer: null
    },
    specApproval: true,
    maxWorkers: 3,
    taskMinutes: 30
  },
  {
    id: 'budget',
    name: 'Budget',
    builtIn: true,
    roles: {
      lead: 'p-lead-budget', 'spec-writer': 'p-ux-reviewer', implementer: 'p-implementer-budget', ui: 'p-ui',
      'code-reviewer': 'p-code-reviewer-budget', 'ux-reviewer': 'p-ux-reviewer', tester: 'p-tester-budget', fixer: null
    },
    specApproval: true,
    maxWorkers: 2,
    taskMinutes: 30
  }
]

export function defaultOrchSettings(): OrchSettings {
  return {
    profiles: DEFAULT_PROFILES.map((p) => ({ ...p })),
    plans: DEFAULT_PLANS.map((p) => ({ ...p, roles: { ...p.roles } })),
    defaultPlanId: DEFAULT_PLAN_ID,
    prices: {}
  }
}

/** The profile a plan uses for a role; undefined when the plan has no agent for it. */
export function profileFor(settings: OrchSettings, plan: OrchPlan, role: OrchRole): OrchProfile | undefined {
  if (role === 'fixer') return fixerProfileOf(settings, plan)
  const id = plan.roles[role]
  return id ? settings.profiles.find((p) => p.id === id) : undefined
}

/** Bug fixes run on the plan's fixer, or on its lead ("main") model when no fixer is set. */
export function fixerProfileOf(settings: OrchSettings, plan: OrchPlan): OrchProfile | undefined {
  const id = plan.roles.fixer
  const lead = plan.roles.lead
  return (id && settings.profiles.find((p) => p.id === id)) || (lead ? settings.profiles.find((p) => p.id === lead) : undefined)
}

/** Agents run locally are registered with runner `<runner>-local`, which is always free. */
export function priceLookupFor(settings: OrchSettings): PriceLookup {
  return (runner, model) => (runner.endsWith('-local') ? 'free' : settings.prices[`${runner}:${model}`] ?? null)
}

// ---- Sanitizing (settings come from disk or a transferred file) ----

type Raw = Record<string, unknown>
const isRaw = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max = 200): string | null => (typeof value === 'string' ? value.slice(0, max) : null)
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  options.includes(value as T) ? (value as T) : null
const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

function sanitizeProfile(value: unknown): OrchProfile | null {
  if (!isRaw(value)) return null
  const id = text(value.id, 80)
  const role = oneOf(value.role, ORCH_ROLES)
  const runner = oneOf(value.runner, ORCH_RUNNERS)
  if (!id || !role || !runner) return null
  return {
    id,
    name: text(value.name) || id,
    role,
    runner,
    model: text(value.model, 120) ?? '',
    effort: oneOf(value.effort, EFFORTS),
    local: runner === 'codex' && value.local === true,
    prompt: text(value.prompt, 8000) ?? ''
  }
}

function sanitizePlan(value: unknown, profileIds: Set<string>): OrchPlan | null {
  if (!isRaw(value)) return null
  const id = text(value.id, 80)
  if (!id) return null
  const rawRoles = isRaw(value.roles) ? value.roles : {}
  const roles: OrchPlan['roles'] = {}
  for (const role of ORCH_ROLES) {
    if (!(role in rawRoles)) continue
    const ref = rawRoles[role]
    roles[role] = typeof ref === 'string' && profileIds.has(ref) ? ref : null
  }
  return {
    id,
    name: text(value.name) || id,
    builtIn: value.builtIn === true,
    roles,
    specApproval: value.specApproval !== false,
    maxWorkers: clamp(value.maxWorkers, 1, MAX_WORKERS_LIMIT, 3),
    taskMinutes: clamp(value.taskMinutes, MIN_TASK_MINUTES, MAX_TASK_MINUTES, 30)
  }
}

function sanitizePrices(value: unknown): Record<string, ModelPrice> {
  if (!isRaw(value)) return {}
  const prices: Record<string, ModelPrice> = {}
  const rate = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  for (const [key, raw] of Object.entries(value)) {
    if (!isRaw(raw) || !/^[a-z-]+:.+/.test(key)) continue
    const inputPerM = rate(raw.inputPerM)
    const outputPerM = rate(raw.outputPerM)
    if (inputPerM === undefined || outputPerM === undefined) continue
    const price: ModelPrice = { inputPerM, outputPerM }
    const cacheRead = rate(raw.cacheReadPerM)
    const cacheWrite = rate(raw.cacheWritePerM)
    if (cacheRead !== undefined) price.cacheReadPerM = cacheRead
    if (cacheWrite !== undefined) price.cacheWritePerM = cacheWrite
    prices[key] = price
  }
  return prices
}

function uniqueById<T extends { id: string }>(items: readonly (T | null)[]): T[] {
  const seen = new Set<string>()
  return items.filter((item): item is T => item !== null && !seen.has(item.id) && Boolean(seen.add(item.id)))
}

export function sanitizeOrchSettings(value: unknown): OrchSettings {
  const defaults = defaultOrchSettings()
  if (!isRaw(value)) return defaults
  const userProfiles = uniqueById(Array.isArray(value.profiles) ? value.profiles.map(sanitizeProfile) : [])
  // Built-in profiles keep their place (edited or not); the user's own follow.
  const ordered = [
    ...defaults.profiles.map((d) => userProfiles.find((p) => p.id === d.id) ?? d),
    ...userProfiles.filter((p) => !defaults.profiles.some((d) => d.id === p.id))
  ]
  const profileIds = new Set(ordered.map((p) => p.id))
  const userPlans = uniqueById(Array.isArray(value.plans) ? value.plans.map((p) => sanitizePlan(p, profileIds)) : [])
  const plans = [
    ...defaults.plans.map((d) => userPlans.find((p) => p.id === d.id) ?? d).map((p) => ({ ...p, builtIn: true })),
    ...userPlans.filter((p) => !defaults.plans.some((d) => d.id === p.id)).map((p) => ({ ...p, builtIn: false }))
  ]
  const defaultPlanId = typeof value.defaultPlanId === 'string' && plans.some((p) => p.id === value.defaultPlanId)
    ? value.defaultPlanId
    : DEFAULT_PLAN_ID
  return { profiles: ordered, plans, defaultPlanId, prices: sanitizePrices(value.prices) }
}
