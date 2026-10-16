import { expect, it } from 'vitest'
import { sessionEvidence } from '../../src/shared/sessionDetail'

const lines = (...records: unknown[]) => records.map(r => JSON.stringify(r)).join('\n')
it('reads Claude branch and actual activity bounds, ignoring file modification time', () => {
  expect(sessionEvidence('claude', lines(
    { type: 'user', timestamp: '2026-10-16T10:00:00Z', gitBranch: 'feature/26412-stock' },
    { type: 'assistant', timestamp: '2026-10-16T11:00:00Z', gitBranch: 'fix/18550' },
    { type: 'summary', timestamp: 'bad' }
  ))).toEqual({ branch: 'fix/18550', startedAt: Date.parse('2026-10-16T10:00:00Z'), endedAt: Date.parse('2026-10-16T11:00:00Z') })
})
it('reads Codex rollout git metadata and activity timestamps', () => {
  expect(sessionEvidence('codex', lines(
    { type: 'session_meta', payload: { timestamp: '2026-10-16T10:00:00Z', git: { branch: 'feat/123' } } },
    { type: 'event_msg', timestamp: '2026-10-16T11:00:00Z', payload: { type: 'agent_message' } }
  ))).toEqual({ branch: 'feat/123', startedAt: Date.parse('2026-10-16T10:00:00Z'), endedAt: Date.parse('2026-10-16T11:00:00Z') })
})
it('reads Gemini JSON and JSONL without inventing a branch when absent', () => {
  expect(sessionEvidence('gemini', JSON.stringify({ startTime: '2026-10-16T10:00:00Z', lastUpdated: '2026-10-16T11:00:00Z', messages: [] }, null, 2)))
    .toEqual({ branch: null, startedAt: Date.parse('2026-10-16T10:00:00Z'), endedAt: Date.parse('2026-10-16T11:00:00Z') })
  expect(sessionEvidence('gemini', lines({ startTime: '2026-10-16T10:00:00Z' }, { id: 'x', timestamp: '2026-10-16T11:00:00Z' }))).toMatchObject({ branch: null, endedAt: Date.parse('2026-10-16T11:00:00Z') })
  expect(sessionEvidence('claude', 'garbage\n{}')).toEqual({ branch: null })
})
