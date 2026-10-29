import { describe, expect, it } from 'vitest'
import {
  blankMember,
  buildPrompt,
  duplicateMember,
  effectiveTemplate,
  fillTemplate,
  findMember,
  initialsOf,
  missingFields,
  modelFits,
  resolveRun,
  runFields,
  runTitle,
  sanitizeCrew,
  sanitizeCrewRuns,
  sanitizeIdentity,
  sanitizeMember,
  templateFields,
  uniqueMemberId
} from '../../src/shared/crew'
import { BUILTIN_IDS, BUILTIN_MEMBERS, crewMembers, visibleMembers } from '../../src/shared/crewBuiltins'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'

describe('model names', () => {
  it('accepts the model names each CLI takes', () => {
    expect(modelFits('codex', 'gpt-5.6-sol')).toBe(true)
    expect(modelFits('claude', 'opus')).toBe(true)
    expect(modelFits('claude', 'claude-sonnet-5-5')).toBe(true)
    expect(modelFits('gemini', 'gemini-2.5-pro')).toBe(true)
  })

  it('rejects a flag passed as a model, and any other shape', () => {
    for (const runner of ['claude', 'codex', 'gemini'] as const) {
      expect(modelFits(runner, '--yolo')).toBe(false)
      expect(modelFits(runner, '-m')).toBe(false)
      expect(modelFits(runner, 'a'.repeat(61))).toBe(false)
      expect(modelFits(runner, 'x & calc')).toBe(false)
    }
    expect(modelFits('claude', '')).toBe(false)
    expect(modelFits('codex', '')).toBe(true)
  })
})

describe('crew members', () => {
  it('ships the eight built-ins with a lead, read-only roles and unique identities', () => {
    expect(BUILTIN_MEMBERS.map((m) => m.name)).toEqual(['Maya', 'Sami', 'Tarek', 'Omar', 'Hana', 'Lina', 'Nour', 'Yara'])
    expect(BUILTIN_MEMBERS.filter((m) => m.lead).map((m) => m.name)).toEqual(['Maya'])
    expect(new Set(BUILTIN_MEMBERS.map((m) => m.initials)).size).toBe(8)
    expect(BUILTIN_MEMBERS.every((m) => m.builtin && m.instructions.length > 40)).toBe(true)
    expect(BUILTIN_MEMBERS.find((m) => m.id === 'omar')?.instructions).toMatch(/Never push/)
    expect(BUILTIN_MEMBERS.find((m) => m.id === 'sami')?.permissions).toBe('read')
  })

  it('hides built-ins by id and keeps your own members after them', () => {
    const mine = blankMember([], 'Rami')
    const crew = { members: [mine], hidden: ['hana'] }
    expect(crewMembers(crew).find((m) => m.id === 'hana')?.hidden).toBe(true)
    expect(visibleMembers(crew).some((m) => m.id === 'hana')).toBe(false)
    expect(crewMembers(crew).at(-1)?.id).toBe('rami')
  })

  it('loads old settings without a crew section', () => {
    const settings = migrateSettings({ version: 2, projects: [{ id: 'p', name: 'P', folder: 'C:/p' }] })
    expect(settings.crew).toEqual({ members: [], hidden: [] })
    expect(settings.crewRuns).toEqual([])
    expect(defaultSettings().crew.members).toEqual([])
  })

  it('validates members: names, ids, enums, models and clamps', () => {
    const good = sanitizeMember({ id: 'zaid', name: ' Zaid ', role: 'Investigator', colour: 'cyan', runner: 'codex', model: 'gpt-5.6', permissions: 'read', startup: 'usual', effort: 'high' })
    expect(good).toMatchObject({ id: 'zaid', name: 'Zaid', colour: 'cyan', runner: 'codex', model: 'gpt-5.6', permissions: 'read', startup: 'usual', effort: 'high', builtin: false })
    expect(good?.initials).toBe('ZA')
    expect(sanitizeMember({ id: 'x', name: '' })).toBeNull()
    expect(sanitizeMember({ name: 'No id' })).toBeNull()
    expect(sanitizeMember('nope')).toBeNull()
    const bad = sanitizeMember({ id: 'b', name: 'Bad', colour: 'teal', runner: 'vim', model: 'rm -rf; x', permissions: 'root', startup: 'x', effort: 'nuclear', builtin: true })!
    expect(bad).toMatchObject({ colour: 'blue', runner: 'claude', model: 'sonnet', permissions: 'ask', startup: 'lean', effort: '', builtin: false })
    expect(sanitizeMember({ id: 'c', name: 'C', runner: 'claude', model: '' })?.model).toBe('sonnet')
    expect(sanitizeMember({ id: 'c', name: 'C', runner: 'gemini', model: '' })?.model).toBe('')
  })

  it('drops duplicate ids, built-in ids, unknown hidden ids and keeps source links safe', () => {
    const crew = sanitizeCrew(
      {
        members: [
          { id: 'a', name: 'A', source: { kind: 'agent', path: 'C:/x/a.md', linked: true } },
          { id: 'a', name: 'Again' },
          { id: 'sami', name: 'Fake Sami' },
          { id: 'b', name: 'B', source: { kind: 'skill', path: '', linked: true } },
          { id: 'c', name: 'C', paste: [{ kind: 'pr', field: 'pr' }, { kind: 'pr', field: 'not a word' }, { kind: 'zip', field: 'x' }] }
        ],
        hidden: ['sami', 'nobody', 'sami']
      },
      BUILTIN_IDS
    )
    expect(crew.members.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(crew.members[0].source).toEqual({ kind: 'agent', path: 'C:/x/a.md', linked: true })
    expect(crew.members[1].source).toEqual({ kind: 'dawsha', path: '', linked: false })
    expect(crew.members[2].paste).toEqual([{ kind: 'pr', field: 'pr' }])
    expect(crew.hidden).toEqual(['sami'])
  })

  it('validates run history and keeps the newest hundred', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `r${i}`, runner: 'claude', startedAt: i, outcome: i % 2 ? 'done' : 'weird', memberId: 'sami', memberName: 'Sami' }))
    const runs = sanitizeCrewRuns([...many, { id: 'r1', runner: 'claude' }, { id: 'z', runner: 'vim' }, 7])
    expect(runs).toHaveLength(100)
    expect(runs[0].id).toBe('r129')
    expect(runs.find((r) => r.id === 'r0')).toBeUndefined()
    expect(sanitizeCrewRuns(many.slice(0, 2))[1].outcome).toBe('closed')
    expect(sanitizeCrewRuns('x')).toEqual([])
  })

  it('validates a pane identity', () => {
    expect(sanitizeIdentity({ runId: 'ab12', memberId: 'sami', name: 'Sami', colour: 'red', initials: 'sa', lead: false })).toMatchObject({ initials: 'SA', colour: 'red' })
    expect(sanitizeIdentity({ runId: '', name: 'x' })).toBeUndefined()
    expect(sanitizeIdentity(null)).toBeUndefined()
  })

  it('makes initials, ids and copies', () => {
    expect(initialsOf('Zaid')).toBe('ZA')
    expect(initialsOf('zaid')).toBe('ZA')
    expect(initialsOf('mary ann')).toBe('MA')
    expect(initialsOf('Mary Ann')).toBe('MA')
    expect(initialsOf('  ')).toBe('??')
    expect(uniqueMemberId([{ id: 'rami' }, { id: 'rami-2' }], 'Rami')).toBe('rami-3')
    const sami = BUILTIN_MEMBERS[1]
    const copy = duplicateMember(sami, [...BUILTIN_MEMBERS])
    expect(copy).toMatchObject({ name: 'Sami 2', builtin: false, id: 'sami-2', permissions: 'read' })
    expect(duplicateMember(sami, [...BUILTIN_MEMBERS, copy]).name).toBe('Sami 3')
    expect(findMember(BUILTIN_MEMBERS, ' SAMI ')?.id).toBe('sami')
    expect(findMember(BUILTIN_MEMBERS, 'nobody')).toBeUndefined()
  })
})

describe('prompt templates', () => {
  it('finds each field once, in order', () => {
    expect(templateFields('Review PR {{pr}} in {{ env }} ({{pr}})')).toEqual(['pr', 'env'])
    expect(templateFields('no fields')).toEqual([])
  })

  it('gives a member without fields one free task field', () => {
    expect(effectiveTemplate('')).toBe('{{task}}')
    expect(effectiveTemplate('Use the skill.')).toBe('Use the skill.\n\n{{task}}')
    expect(runFields({ prompt: 'Use {{a}}' })).toEqual(['a'])
    expect(runFields({ prompt: '' })).toEqual(['task'])
  })

  it('fills fields and reports the missing ones', () => {
    expect(fillTemplate('Review {{target}} on {{env}}', { target: ' PR 7 ', env: 'dev' })).toBe('Review PR 7 on dev')
    expect(buildPrompt({ prompt: 'Look at {{x}}' }, {})).toBe('Look at')
    expect(missingFields({ prompt: 'a {{x}} {{y}}' }, { x: 'ok', y: '  ' })).toEqual(['y'])
  })

  it('titles a run with the first field value', () => {
    expect(runTitle({ name: 'Rami', prompt: 'Review PR {{pr}} {{mode}}' }, { pr: '8841', mode: 'draft' })).toBe('Rami · PR 8841')
    expect(runTitle({ name: 'Sami', prompt: 'Review {{target}}' }, { target: 'feat/1.7.4 diff\nmore' })).toBe('Sami · feat/1.7.4 diff')
    expect(runTitle({ name: 'Yara', prompt: '' }, {})).toBe('Yara')
    expect(runTitle({ name: 'Zaid', prompt: '{{id}} {{env}}' }, { id: '', env: 'uat' })).toBe('Zaid · uat')
    expect(runTitle({ name: 'Y', prompt: '{{t}}' }, { t: 'x'.repeat(80) }).length).toBeLessThan(60)
  })
})

describe('run choices', () => {
  const tarek = { runner: 'codex' as const, model: 'gpt-5.6' }
  it('maps a model choice to a runner and model', () => {
    expect(resolveRun(tarek, 'default')).toEqual({ runner: 'codex', model: 'gpt-5.6' })
    expect(resolveRun(tarek, 'opus')).toEqual({ runner: 'claude', model: 'opus' })
    expect(resolveRun(tarek, 'fable')).toEqual({ runner: 'claude', model: 'fable' })
    expect(resolveRun({ runner: 'claude', model: 'haiku' }, 'codex')).toEqual({ runner: 'codex', model: '' })
    expect(resolveRun(tarek, 'codex')).toEqual({ runner: 'codex', model: 'gpt-5.6' })
    expect(resolveRun(tarek, 'gemini')).toEqual({ runner: 'gemini', model: '' })
  })
})
