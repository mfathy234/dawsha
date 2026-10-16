import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLAN_ID,
  defaultOrchSettings,
  fixerProfileOf,
  priceLookupFor,
  profileFor,
  sanitizeOrchSettings
} from '../../src/shared/orch/profiles'
import { ORCH_ROLES } from '../../src/shared/orch/types'

describe('orchestrator profiles and plans', () => {
  it('ships Default and Budget plans that cover every role', () => {
    const settings = defaultOrchSettings()
    expect(settings.plans.map((p) => p.name)).toEqual(['Default', 'Budget'])
    for (const plan of settings.plans) {
      for (const role of ORCH_ROLES) expect(profileFor(settings, plan, role), `${plan.name} ${role}`).toBeDefined()
    }
    const plan = settings.plans[0]
    expect(profileFor(settings, plan, 'lead')).toMatchObject({ runner: 'claude', model: 'opus', effort: 'high' })
    expect(profileFor(settings, plan, 'implementer')).toMatchObject({ runner: 'claude', model: 'sonnet' })
    // Every built-in plan runs on Claude only; Codex and Gemini profiles are there to pick.
    for (const p of settings.plans) for (const role of ORCH_ROLES) expect(profileFor(settings, p, role)?.runner, `${p.name} ${role}`).toBe('claude')
    expect(settings.profiles.map((p) => p.runner)).toEqual(expect.arrayContaining(['codex', 'gemini']))
  })

  it('upgrades stored built-in profiles that still have the earlier Codex and Gemini defaults, and keeps edited ones', () => {
    const stored = defaultOrchSettings()
    stored.profiles = stored.profiles.map((p) =>
      p.id === 'p-implementer' ? { ...p, runner: 'codex', model: '', effort: 'medium' }
        : p.id === 'p-ux-reviewer' ? { ...p, runner: 'gemini', model: '', effort: null }
          : p.id === 'p-tester-budget' ? { ...p, runner: 'gemini', model: 'gemini-pro', effort: null } : p)
    const upgraded = sanitizeOrchSettings(JSON.parse(JSON.stringify(stored)))
    const byId = (id: string) => upgraded.profiles.find((p) => p.id === id)
    expect(byId('p-implementer')).toMatchObject({ runner: 'claude', model: 'sonnet' })
    expect(byId('p-ux-reviewer')).toMatchObject({ runner: 'claude', model: 'sonnet' })
    // The user picked a model for this one: theirs stays.
    expect(byId('p-tester-budget')).toMatchObject({ runner: 'gemini', model: 'gemini-pro' })
  })

  it('uses the plan lead ("main") model for bug fixes unless a fixer is set', () => {
    const settings = defaultOrchSettings()
    const plan = settings.plans[0]
    expect(fixerProfileOf(settings, plan)).toEqual(profileFor(settings, plan, 'lead'))
    const custom = { ...plan, roles: { ...plan.roles, fixer: 'p-implementer' } }
    expect(fixerProfileOf(settings, custom)?.id).toBe('p-implementer')
  })

  it('repairs broken settings and keeps valid user changes', () => {
    expect(sanitizeOrchSettings(undefined)).toEqual(defaultOrchSettings())
    expect(sanitizeOrchSettings({ plans: 'x', profiles: [{ junk: true }] })).toEqual(defaultOrchSettings())
    const mine = {
      ...defaultOrchSettings(),
      profiles: [
        ...defaultOrchSettings().profiles,
        { id: 'p-local-ux', name: 'UX local', role: 'ux-reviewer', runner: 'codex', model: 'qwen3-coder', effort: 'max', local: true, prompt: '' }
      ],
      plans: [
        ...defaultOrchSettings().plans,
        { id: 'mine', name: 'Mine', builtIn: false, roles: { 'ux-reviewer': 'p-local-ux', lead: 'missing-profile' }, specApproval: false, maxWorkers: 99, taskMinutes: 1 }
      ],
      defaultPlanId: 'mine',
      prices: { 'codex:gpt-5': { inputPerM: 1.25, outputPerM: 10 }, 'bad:model': { inputPerM: -1, outputPerM: 'x' } }
    }
    const clean = sanitizeOrchSettings(JSON.parse(JSON.stringify(mine)))
    const plan = clean.plans.find((p) => p.id === 'mine')
    expect(plan).toMatchObject({ specApproval: false, maxWorkers: 5, taskMinutes: 5 })
    expect(plan?.roles.lead).toBeNull()
    expect(profileFor(clean, plan!, 'ux-reviewer')).toMatchObject({ local: true, effort: 'max' })
    expect(clean.defaultPlanId).toBe('mine')
    expect(clean.prices).toEqual({ 'codex:gpt-5': { inputPerM: 1.25, outputPerM: 10 } })
  })

  it('puts built-in plans back if they were removed and falls back to the Default plan', () => {
    const clean = sanitizeOrchSettings({ ...defaultOrchSettings(), plans: [], defaultPlanId: 'gone' })
    expect(clean.plans.map((p) => p.id)).toEqual(['default', 'budget'])
    expect(clean.defaultPlanId).toBe(DEFAULT_PLAN_ID)
  })

  it('prices local models as free and unknown models as unpriced', () => {
    const lookup = priceLookupFor({ ...defaultOrchSettings(), prices: { 'codex:gpt-5': { inputPerM: 1, outputPerM: 2 } } })
    expect(lookup('codex-local', 'qwen3-coder')).toBe('free')
    expect(lookup('codex', 'gpt-5')).toEqual({ inputPerM: 1, outputPerM: 2 })
    expect(lookup('gemini', 'gemini-pro')).toBeNull()
  })
})
