import { describe, expect, it } from 'vitest'
import { filterSkills, skillExportLabel, skillExportSummary } from '../../src/shared/skillSearch'
import type { SkillEntry } from '../../src/shared/skills'

const entry = (name: string, agent: SkillEntry['agent'], kind: SkillEntry['kind'] = 'skill', project?: string): SkillEntry => ({
  id: name,
  name,
  agent,
  kind,
  scope: project ? 'project' : 'user',
  path: `/home/me/.${agent}/skills/${name}`,
  project
})

const entries = [entry('code-review', 'claude'), entry('tdd', 'codex'), entry('deploy', 'claude', 'skill', 'billing-api'), entry('architect', 'claude', 'agent')]

describe('filterSkills', () => {
  it('filters by kind and agent, and matches every search term anywhere', () => {
    expect(filterSkills(entries, { kind: 'skill', agent: 'all', query: '' }).map((e) => e.name)).toEqual(['code-review', 'tdd', 'deploy'])
    expect(filterSkills(entries, { kind: 'skill', agent: 'claude', query: '' }).map((e) => e.name)).toEqual(['code-review', 'deploy'])
    expect(filterSkills(entries, { kind: 'skill', agent: 'all', query: 'BILLING deploy' }).map((e) => e.name)).toEqual(['deploy'])
    expect(filterSkills(entries, { kind: 'skill', agent: 'all', query: 'review codex' })).toEqual([])
    expect(filterSkills(entries, { kind: 'agent', agent: 'all', query: 'arch' }).map((e) => e.name)).toEqual(['architect'])
  })
})

describe('skill export copy', () => {
  it('names what the button exports', () => {
    expect(skillExportLabel(12, 'skill', 'all')).toBe('Export all 12 skills')
    expect(skillExportLabel(1, 'agent', 'codex')).toBe('Export 1 Codex agent')
    expect(skillExportLabel(0, 'skill', 'gemini')).toBe('Export skills')
  })

  it('summarizes skipped items', () => {
    expect(skillExportSummary({ folder: '/out/dawsha-export', exported: 3, skipped: [] })).toBe('Exported 3 to /out/dawsha-export.')
    const skipped = ['a', 'b', 'c'].map((name) => ({ name, reason: 'already exists' }))
    expect(skillExportSummary({ folder: '/o', exported: 0, skipped })).toBe('Exported 0 to /o. Skipped 3: a (already exists), b (already exists) and 1 more.')
  })
})
