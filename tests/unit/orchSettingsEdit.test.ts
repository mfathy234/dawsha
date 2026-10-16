import { describe, expect, it } from 'vitest'
import { defaultOrchSettings, sanitizeOrchSettings } from '../../src/shared/orch/profiles'
import {
  addPlan,
  addProfile,
  deletePlan,
  deleteProfile,
  priceKeys,
  profileUses,
  setDefaultPlan,
  setPlanRole,
  setPrice,
  setProfileRole,
  updatePlan,
  updateProfile
} from '../../src/shared/orch/settingsEdit'

const base = () => defaultOrchSettings()
const noPrice = { inputPerM: null, outputPerM: null, cacheReadPerM: null, cacheWritePerM: null }

describe('plan edits', () => {
  it('copies a plan without touching the source', () => {
    const before = base()
    const { settings, planId } = addPlan(before, 'default', 'My plan')
    const copy = settings.plans.find((p) => p.id === planId)
    expect(copy).toMatchObject({ name: 'My plan', builtIn: false, maxWorkers: 3 })
    expect(copy?.roles).toEqual(before.plans[0].roles)
    expect(copy?.roles).not.toBe(before.plans[0].roles)
    expect(before.plans).toHaveLength(2)
    expect(addPlan(settings, 'default', 'Again').planId).not.toBe(planId)
  })

  it('refuses to delete built-in plans and falls back to the default plan when the default is deleted', () => {
    const { settings, planId } = addPlan(base(), 'default', 'Mine')
    expect(deletePlan(base(), 'budget')).toEqual({ ok: false, error: 'Built-in plans cannot be deleted.' })
    const chosen = setDefaultPlan(settings, planId)
    expect(chosen.defaultPlanId).toBe(planId)
    const result = deletePlan(chosen, planId)
    expect(result.ok && result.settings.plans.some((p) => p.id === planId)).toBe(false)
    expect(result.ok && result.settings.defaultPlanId).toBe('default')
  })

  it('edits limits and names, but keeps built-in names', () => {
    const { settings, planId } = addPlan(base(), 'default', 'Mine')
    const edited = updatePlan(settings, planId, { name: 'Renamed', maxWorkers: 4, specApproval: false, taskMinutes: 45 })
    expect(edited.plans.find((p) => p.id === planId)).toMatchObject({ name: 'Renamed', maxWorkers: 4, specApproval: false, taskMinutes: 45 })
    expect(updatePlan(settings, 'default', { name: 'Hacked' }).plans[0].name).toBe('Default')
  })

  it('sets a role only to a profile of that role, or null', () => {
    const s = base()
    expect(setPlanRole(s, 'default', 'tester', 'p-tester-budget').plans[0].roles.tester).toBe('p-tester-budget')
    expect(setPlanRole(s, 'default', 'tester', null).plans[0].roles.tester).toBeNull()
    expect(setPlanRole(s, 'default', 'tester', 'p-lead')).toBe(s)
  })
})

describe('profile edits', () => {
  it('adds a profile for a role and duplicates it', () => {
    const { settings, profileId } = addProfile(base(), 'tester')
    expect(settings.profiles.find((p) => p.id === profileId)).toMatchObject({ role: 'tester', runner: 'claude', local: false })
    const dup = addProfile(settings, 'tester', profileId)
    expect(dup.settings.profiles.find((p) => p.id === dup.profileId)?.name).toBe('New profile copy')
  })

  it('resets effort and local when the runner changes', () => {
    const s = updateProfile(base(), 'p-implementer', { local: true })
    expect(s.profiles.find((p) => p.id === 'p-implementer')?.local).toBe(true)
    const moved = updateProfile(s, 'p-implementer', { runner: 'gemini' })
    expect(moved.profiles.find((p) => p.id === 'p-implementer')).toMatchObject({ runner: 'gemini', local: false, effort: null })
  })

  it('finds plans that use a profile', () => {
    expect(profileUses(base(), 'p-lead')).toEqual([{ planId: 'default', planName: 'Default', role: 'lead' }])
    expect(profileUses(base(), 'p-ux-reviewer').map((u) => u.planName)).toEqual(['Default', 'Budget', 'Budget'])
  })

  it('refuses to delete a used or built-in profile and deletes a free one', () => {
    expect(deleteProfile(base(), 'p-lead').ok).toBe(false)
    const { settings, profileId } = addProfile(base(), 'tester')
    const free = deleteProfile(settings, profileId)
    expect(free.ok && free.settings.profiles.some((p) => p.id === profileId)).toBe(false)
  })

  it('reports which plan blocks a deletion', () => {
    const { settings, profileId } = addProfile(base(), 'tester')
    const used = setPlanRole(settings, 'default', 'tester', profileId)
    const result = deleteProfile(used, profileId)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('Default')
  })

  it('refuses to change the role of a profile that a plan uses', () => {
    expect(setProfileRole(base(), 'p-lead', 'tester').ok).toBe(false)
    const { settings, profileId } = addProfile(base(), 'tester')
    const moved = setProfileRole(settings, profileId, 'ui')
    expect(moved.ok && moved.settings.profiles.find((p) => p.id === profileId)?.role).toBe('ui')
  })
})

describe('prices', () => {
  it('lists runner:model keys of non-local profiles with a model', () => {
    const s = updateProfile(base(), 'p-implementer', { model: 'gpt-5', local: true })
    const keys = priceKeys(s)
    expect(keys).toContain('claude:opus')
    expect(keys).not.toContain('codex:gpt-5')
    expect(keys.every((k) => !k.endsWith(':'))).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('stores a price once input and output are set, and clears it when all are empty', () => {
    const priced = setPrice(base(), 'claude:opus', { inputPerM: 15, outputPerM: 75, cacheReadPerM: null, cacheWritePerM: 18 })
    expect(priced.prices['claude:opus']).toEqual({ inputPerM: 15, outputPerM: 75, cacheWritePerM: 18 })
    expect(setPrice(priced, 'claude:opus', noPrice).prices).toEqual({})
  })

  it('leaves settings alone while a price is incomplete or invalid', () => {
    const s = base()
    expect(setPrice(s, 'claude:opus', { ...noPrice, inputPerM: 15 })).toBe(s)
    expect(setPrice(s, 'claude:opus', { ...noPrice, inputPerM: -1, outputPerM: 5 })).toBe(s)
  })

  it('survives sanitizing', () => {
    const priced = setPrice(base(), 'claude:opus', { ...noPrice, inputPerM: 15, outputPerM: 75 })
    expect(sanitizeOrchSettings(priced).prices['claude:opus']).toEqual({ inputPerM: 15, outputPerM: 75 })
  })
})
