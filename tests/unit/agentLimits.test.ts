import { describe, expect, it } from 'vitest'
import { allAgentLimits, dataAge, focusedLimits, limitsStale, meterLimits, mostUrgentLimits, recordLimits, type AgentLimitStore } from '../../src/shared/agentLimits'
import type { RateLimitWindow } from '../../src/shared/types'

const NOW = 1_791_451_700_000
const win = (percent: number, resetsAt: number | null = NOW + 3_600_000): RateLimitWindow => ({ key: 'five_hour', label: '5h', percent, resetsAt })

describe('recordLimits', () => {
  it('keeps the latest reading per agent and ignores shells and empty readings', () => {
    const store = recordLimits({}, [
      { agent: 'claude', windows: [win(62)], at: NOW - 1000 },
      { agent: 'codex', windows: [win(1)], at: NOW - 2000 },
      { agent: 'shell', windows: [win(99)], at: NOW },
      { agent: 'gemini', windows: [], at: NOW }
    ])
    expect(Object.keys(store).sort()).toEqual(['claude', 'codex'])
    expect(store.claude?.windows[0].percent).toBe(62)
  })

  it('replaces older data, keeps newer data and returns the same store when nothing changed', () => {
    const first = recordLimits({}, [{ agent: 'claude', windows: [win(10)], at: NOW - 5000 }])
    const newer = recordLimits(first, [{ agent: 'claude', windows: [win(20)], at: NOW - 1000 }])
    expect(newer.claude?.windows[0].percent).toBe(20)
    expect(recordLimits(newer, [{ agent: 'claude', windows: [win(5)], at: NOW - 3000 }])).toBe(newer)
  })
})

describe('focusedLimits', () => {
  const store: AgentLimitStore = recordLimits({}, [
    { agent: 'claude', windows: [win(62)], at: NOW - 1000 },
    { agent: 'codex', windows: [win(1)], at: NOW - 1000 }
  ])

  it('shows the focused Claude pane its own windows', () => {
    const result = focusedLimits(store, 'claude', NOW)
    expect(result).toMatchObject({ agent: 'claude', state: 'fresh' })
    expect(result?.windows[0].percent).toBe(62)
  })

  it('shows the focused Codex pane the Codex windows, not Claude', () => {
    const result = focusedLimits(store, 'codex', NOW)
    expect(result?.agent).toBe('codex')
    expect(result?.windows[0].percent).toBe(1)
  })

  it('never borrows another agent numbers for Gemini, or for a pane that has not reported', () => {
    expect(focusedLimits(store, 'gemini', NOW)).toEqual({ agent: 'gemini', state: 'none', windows: [], at: null })
    expect(focusedLimits({}, 'claude', NOW)).toEqual({ agent: 'claude', state: 'none', windows: [], at: null })
  })

  it('has nothing to show for a shell or without a pane', () => {
    expect(focusedLimits(store, 'shell', NOW)).toBeNull()
    expect(focusedLimits(store, null, NOW)).toBeNull()
  })
})

describe('staleness', () => {
  it('marks old data and data past its reset as stale', () => {
    expect(limitsStale({ windows: [win(40)], at: NOW - 31 * 60_000 }, NOW)).toBe(true)
    expect(limitsStale({ windows: [win(40, NOW - 1000)], at: NOW - 1000 }, NOW)).toBe(true)
    expect(limitsStale({ windows: [win(40)], at: NOW - 1000 }, NOW)).toBe(false)
    expect(limitsStale({ windows: [win(40, null)], at: NOW - 1000 }, NOW)).toBe(false)
  })

  it('lists every agent in a fixed order with its state', () => {
    const store = recordLimits({}, [{ agent: 'claude', windows: [win(40)], at: NOW - 40 * 60_000 }])
    expect(allAgentLimits(store, NOW).map((entry) => [entry.agent, entry.state])).toEqual([['claude', 'stale'], ['codex', 'none'], ['gemini', 'none']])
  })

  it('words the age of a reading', () => {
    expect(dataAge(NOW - 5000, NOW)).toBe('just now')
    expect(dataAge(NOW - 4 * 60_000, NOW)).toBe('4m ago')
    expect(dataAge(NOW - 3 * 3_600_000, NOW)).toBe('3h ago')
  })
})

describe('meterLimits with no agent focused', () => {
  const entry = (percent: number, resetsAt: number | null, at = NOW) => ({ windows: [win(percent, resetsAt)], at })

  it('keeps the focused agent, even with nothing known', () => {
    expect(meterLimits({ claude: entry(10, NOW + 1000) }, 'codex', NOW)?.state).toBe('none')
  })

  it('picks the agent with the highest window that has not reset, for no pane or a shell', () => {
    const store: AgentLimitStore = { claude: entry(62, NOW + 3_600_000), codex: entry(99, NOW + 3_600_000) }
    expect(meterLimits(store, null, NOW)?.agent).toBe('codex')
    expect(meterLimits(store, 'shell', NOW)?.agent).toBe('codex')
  })

  it('ignores windows that already reset', () => {
    const store: AgentLimitStore = { claude: entry(40, NOW + 3_600_000), codex: entry(99, NOW - 1000) }
    expect(mostUrgentLimits(store, NOW)?.agent).toBe('claude')
    expect(mostUrgentLimits({ codex: entry(99, NOW - 1000) }, NOW)).toBeNull()
  })

  it('marks an old last-known reading stale and is null when nothing is known', () => {
    const old = entry(50, NOW + 86_400_000, NOW - 2 * 3_600_000)
    expect(meterLimits({ claude: old }, null, NOW)).toMatchObject({ agent: 'claude', state: 'stale' })
    expect(meterLimits({}, null, NOW)).toBeNull()
  })
})
