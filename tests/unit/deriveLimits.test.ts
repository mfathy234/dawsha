import { describe, expect, it } from 'vitest'
import { derivePanes, paneLimits } from '../../src/renderer/derive'
import { initialState, type AppState, type TermState } from '../../src/renderer/state'
import { parseStatusPayload } from '../../src/shared/statusLine'

const NOW = 1_791_451_700_000
const claudeTab: TermState = { id: 'tab-1', agent: 'claude', label: 'claude', startedAt: NOW - 5000, status: 'running', pid: 101 }
const reading = (sessionId: string, percent: number, receivedAt = NOW - 1000, resetsAt: number | null = NOW + 3_600_000) =>
  parseStatusPayload(JSON.stringify({
    session_id: sessionId,
    rate_limits: { five_hour: { used_percentage: percent, ...(resetsAt === null ? {} : { resets_at: Math.floor(resetsAt / 1000) }) } }
  }), receivedAt)!

describe('paneLimits', () => {
  it('uses only the matching Claude tab reading and keeps missing reset timestamps missing', () => {
    const limits = paneLimits(claudeTab, reading('one', 32, NOW - 1000, null), null, NOW)
    expect(limits).toEqual([{ key: 'five_hour', label: '5h', family: undefined, percent: 32, resetsAt: null }])
    expect(paneLimits({ ...claudeTab, agent: 'codex' }, reading('one', 32), null, NOW)).toEqual([])
  })

  it('ignores a stale reading instead of showing an old limit', () => {
    expect(paneLimits(claudeTab, reading('one', 32, NOW - 31 * 60_000), null, NOW)).toEqual([])
  })
})

describe('derivePanes limits', () => {
  it('keeps limits with their own panes even when another pane has a newer reading', () => {
    const base = initialState()
    const state: AppState = {
      ...base,
      now: NOW,
      bridge: { ...base.bridge, installed: true },
      settings: { ...base.settings, projects: [{ id: 'p', name: 'P', folder: 'C:\\work', defaultAgent: 'claude' }] },
      panes: [
        { id: 'pane-1', projectId: 'p', activeTabId: 'tab-1', fontSize: 15, tabs: [claudeTab] },
        { id: 'pane-2', projectId: 'p', activeTabId: 'tab-2', fontSize: 15, tabs: [{ ...claudeTab, id: 'tab-2', pid: 202 }] }
      ],
      sessions: [
        { pid: 101, sessionId: 'one', cwd: 'C:\\work', status: 'idle', startedAt: NOW - 4000, updatedAt: NOW },
        { pid: 202, sessionId: 'two', cwd: 'C:\\work', status: 'idle', startedAt: NOW - 4000, updatedAt: NOW }
      ],
      statusInfo: { one: reading('one', 32), two: reading('two', 78, NOW) }
    }
    expect(derivePanes(state).map((pane) => pane.info.limits[0]?.percent)).toEqual([32, 78])
  })
})
