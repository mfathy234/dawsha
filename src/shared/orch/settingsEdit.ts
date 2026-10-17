import { supportsEffort } from './launch'
import { defaultOrchSettings, type OrchPlan, type OrchProfile, type OrchSettings } from './profiles'
import type { OrchRole } from './types'
import type { ModelPrice } from './usage'

// Pure edits of the orchestrator settings. Each returns a new object and never mutates its input.

export type EditResult = { ok: true; settings: OrchSettings } | { ok: false; error: string }

/** Roles a plan may leave empty. The others always need an agent. */
export const OPTIONAL_ROLES: readonly OrchRole[] = ['ui', 'ux-reviewer', 'tester', 'fixer']

export type PlanPatch = Partial<Pick<OrchPlan, 'name' | 'specApproval' | 'maxWorkers' | 'taskMinutes'>>
export type ProfilePatch = Partial<Pick<OrchProfile, 'name' | 'runner' | 'model' | 'effort' | 'local' | 'prompt'>>

export interface ProfileUse {
  planId: string
  planName: string
  role: OrchRole
}

export interface PriceRow {
  inputPerM: number | null
  outputPerM: number | null
  cacheReadPerM: number | null
  cacheWritePerM: number | null
}

const uniqueId = (prefix: string, taken: readonly string[]): string => {
  let n = taken.length + 1
  while (taken.includes(`${prefix}-${n}`)) n += 1
  return `${prefix}-${n}`
}

export const isBuiltInProfile = (id: string): boolean => defaultOrchSettings().profiles.some((p) => p.id === id)

export function addPlan(settings: OrchSettings, sourceId: string, name: string): { settings: OrchSettings; planId: string } {
  const source = settings.plans.find((p) => p.id === sourceId) ?? settings.plans[0]
  const planId = uniqueId('plan', settings.plans.map((p) => p.id))
  const plan: OrchPlan = { ...source, id: planId, name, builtIn: false, roles: { ...source.roles } }
  return { settings: { ...settings, plans: [...settings.plans, plan] }, planId }
}

export function deletePlan(settings: OrchSettings, planId: string): EditResult {
  const plan = settings.plans.find((p) => p.id === planId)
  if (!plan) return { ok: false, error: 'That plan no longer exists.' }
  if (plan.builtIn) return { ok: false, error: 'Built-in plans cannot be deleted.' }
  const plans = settings.plans.filter((p) => p.id !== planId)
  const defaultPlanId = settings.defaultPlanId === planId ? defaultOrchSettings().defaultPlanId : settings.defaultPlanId
  return { ok: true, settings: { ...settings, plans, defaultPlanId } }
}

export function setDefaultPlan(settings: OrchSettings, planId: string): OrchSettings {
  return settings.plans.some((p) => p.id === planId) ? { ...settings, defaultPlanId: planId } : settings
}

const mapPlan = (settings: OrchSettings, planId: string, change: (plan: OrchPlan) => OrchPlan): OrchSettings => ({
  ...settings,
  plans: settings.plans.map((p) => (p.id === planId ? change(p) : p))
})

export function updatePlan(settings: OrchSettings, planId: string, patch: PlanPatch): OrchSettings {
  return mapPlan(settings, planId, (plan) => ({ ...plan, ...patch, name: plan.builtIn ? plan.name : (patch.name ?? plan.name) }))
}

export function setPlanRole(settings: OrchSettings, planId: string, role: OrchRole, profileId: string | null): OrchSettings {
  if (profileId !== null && settings.profiles.find((p) => p.id === profileId)?.role !== role) return settings
  return mapPlan(settings, planId, (plan) => ({ ...plan, roles: { ...plan.roles, [role]: profileId } }))
}

export function addProfile(settings: OrchSettings, role: OrchRole, sourceId?: string): { settings: OrchSettings; profileId: string } {
  const source = sourceId ? settings.profiles.find((p) => p.id === sourceId) : undefined
  const profileId = uniqueId('profile', settings.profiles.map((p) => p.id))
  const profile: OrchProfile = source
    ? { ...source, id: profileId, name: `${source.name} copy` }
    : { id: profileId, name: 'New profile', role, runner: 'claude', model: '', effort: null, local: false, prompt: '' }
  return { settings: { ...settings, profiles: [...settings.profiles, profile] }, profileId }
}

export function profileUses(settings: OrchSettings, profileId: string): ProfileUse[] {
  return settings.plans.flatMap((plan) =>
    (Object.entries(plan.roles) as [OrchRole, string | null | undefined][])
      .filter(([, id]) => id === profileId)
      .map(([role]) => ({ planId: plan.id, planName: plan.name, role }))
  )
}

const usesText = (uses: ProfileUse[]): string => [...new Set(uses.map((u) => `"${u.planName}"`))].join(', ')

export function deleteProfile(settings: OrchSettings, profileId: string): EditResult {
  if (!settings.profiles.some((p) => p.id === profileId)) return { ok: false, error: 'That profile no longer exists.' }
  if (isBuiltInProfile(profileId)) return { ok: false, error: 'Built-in profiles cannot be deleted. Change them or add your own.' }
  const uses = profileUses(settings, profileId)
  if (uses.length > 0) return { ok: false, error: `This profile is used by the plan ${usesText(uses)}. Pick another profile there first.` }
  return { ok: true, settings: { ...settings, profiles: settings.profiles.filter((p) => p.id !== profileId) } }
}

export function updateProfile(settings: OrchSettings, profileId: string, patch: ProfilePatch): OrchSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => {
      if (profile.id !== profileId) return profile
      const next = { ...profile, ...patch }
      return {
        ...next,
        local: next.runner === 'codex' && next.local,
        effort: supportsEffort(next.runner) ? next.effort : null
      }
    })
  }
}

export function setProfileRole(settings: OrchSettings, profileId: string, role: OrchRole): EditResult {
  const profile = settings.profiles.find((p) => p.id === profileId)
  if (!profile) return { ok: false, error: 'That profile no longer exists.' }
  if (profile.role === role) return { ok: true, settings }
  const uses = profileUses(settings, profileId)
  if (uses.length > 0) return { ok: false, error: `This profile is used by the plan ${usesText(uses)}. Pick another profile there before changing its role.` }
  return { ok: true, settings: { ...settings, profiles: settings.profiles.map((p) => (p.id === profileId ? { ...p, role } : p)) } }
}

/** Models that can be priced: every paid profile with a named model. A CLI default model has no name to key on. */
export function priceKeys(settings: OrchSettings): string[] {
  const keys = settings.profiles.filter((p) => !p.local && p.model.trim() !== '').map((p) => `${p.runner}:${p.model.trim()}`)
  return [...new Set(keys)]
}

const validRate = (value: number | null): boolean => value === null || (Number.isFinite(value) && value >= 0)

/** Stores the row once input and output are set, removes it when every field is empty, otherwise changes nothing. */
export function setPrice(settings: OrchSettings, key: string, row: PriceRow): OrchSettings {
  const values = [row.inputPerM, row.outputPerM, row.cacheReadPerM, row.cacheWritePerM]
  if (!values.every(validRate)) return settings
  if (values.every((v) => v === null)) {
    const prices = Object.fromEntries(Object.entries(settings.prices).filter(([k]) => k !== key))
    return { ...settings, prices }
  }
  if (row.inputPerM === null || row.outputPerM === null) return settings
  const price: ModelPrice = { inputPerM: row.inputPerM, outputPerM: row.outputPerM }
  if (row.cacheReadPerM !== null) price.cacheReadPerM = row.cacheReadPerM
  if (row.cacheWritePerM !== null) price.cacheWritePerM = row.cacheWritePerM
  return { ...settings, prices: { ...settings.prices, [key]: price } }
}
