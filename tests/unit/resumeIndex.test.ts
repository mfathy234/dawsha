import { describe, expect, it } from 'vitest'
import { ageGroup, groupSessions, matchesQuery, messageWord, sessionSummary } from '../../src/shared/resumeIndex'
import type { ResumeSession } from '../../src/shared/types'

const NOW = new Date(2026, 9, 8, 15, 0, 0).getTime()
const at = (daysAgo: number, hour = 10): number => new Date(2026, 9, 8 - daysAgo, hour, 0, 0).getTime()

const make = (over: Partial<ResumeSession>): ResumeSession => ({
  agent: 'claude',
  id: 'x',
  title: 'Add dark mode toggle',
  projectId: 'p',
  modifiedAt: NOW,
  startedAt: NOW,
  messageCount: 1,
  ...over
})

describe('ageGroup', () => {
  it('buckets by local calendar day', () => {
    expect(ageGroup(at(0, 1), NOW)).toBe('Today')
    expect(ageGroup(at(1, 23), NOW)).toBe('Yesterday')
    expect(ageGroup(at(3), NOW)).toBe('This week')
    expect(ageGroup(at(6), NOW)).toBe('This week')
    expect(ageGroup(at(7), NOW)).toBe('Older')
  })
})

describe('groupSessions', () => {
  it('orders newest first and drops empty groups', () => {
    const groups = groupSessions(
      [make({ id: 'old', modifiedAt: at(30) }), make({ id: 'new', modifiedAt: at(0, 9) }), make({ id: 'mid', modifiedAt: at(0, 12) })],
      NOW
    )
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Older'])
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['mid', 'new'])
  })
})

describe('matchesQuery', () => {
  it('matches every word against title, project, agent or first prompt', () => {
    const s = make({ firstPrompt: 'persist the choice in local storage' })
    expect(matchesQuery(s, 'acme-web', '')).toBe(true)
    expect(matchesQuery(s, 'acme-web', 'dark acme')).toBe(true)
    expect(matchesQuery(s, 'acme-web', 'claude storage')).toBe(true)
    expect(matchesQuery(s, 'acme-web', 'dark billing')).toBe(false)
  })
})

describe('labels', () => {
  it('pluralizes', () => {
    expect(messageWord(1)).toBe('1 message')
    expect(messageWord(34)).toBe('34 messages')
    expect(sessionSummary(8, 4)).toBe('8 sessions across 4 projects')
    expect(sessionSummary(1, 1)).toBe('1 session across 1 project')
  })
})

describe('sessionFacts', () => {
  it('lists messages, work time and when it started, leaving out what is unknown', async () => {
    const { sessionFacts } = await import('../../src/shared/resumeIndex')
    const now = Date.parse('2026-10-20T12:00:00Z')
    const base = { agent: 'claude', id: 'a', title: 't', projectId: 'p', modifiedAt: now - 5 * 60_000, startedAt: now - 3 * 3_600_000, messageCount: 1 } as const
    const facts = sessionFacts({ ...base, activeSpans: [[now - 3_600_000, now - 1_800_000], [now - 600_000, now - 300_000]] }, now)
    expect(facts[0]).toBe('1 message')
    expect(facts[1]).toBe('35m of work')
    expect(facts).toHaveLength(3)
    expect(facts.at(-1)).not.toMatch(/Started|Active/)
    expect(facts.at(-1)).toMatch(/^(Today|Yesterday) /)
    const bare = sessionFacts({ ...base, messageCount: 0 }, now)
    expect(bare.some((f) => f.includes('message') || f.includes('work'))).toBe(false)
  })
})
