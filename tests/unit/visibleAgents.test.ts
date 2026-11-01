import { describe, expect, it } from 'vitest'
import type { ToolReport } from '../../src/shared/agentTools'
import { visibleLimitAgents } from '../../src/shared/visibleAgents'
import type { AgentKind } from '../../src/shared/types'

const tool = (agent: AgentKind, present: boolean): ToolReport => ({ agent, installed: present ? '1.0.0' : null, present, latest: null, latestFailed: false, installKind: null })
const report = [tool('claude', true), tool('codex', true), tool('gemini', false)]
const base = { report, withData: [] as AgentKind[], signedIn: [] as AgentKind[], focused: null }

describe('visibleLimitAgents', () => {
  it('shows installed agents, even with no readings and no account', () => {
    expect(visibleLimitAgents(base)).toEqual(['claude', 'codex'])
  })

  it('hides an agent known not to be installed even with old readings or an account', () => {
    expect(visibleLimitAgents({ ...base, withData: ['gemini'], signedIn: ['gemini'] })).toEqual(['claude', 'codex'])
  })

  it('shows a not-installed agent while its session is focused', () => {
    expect(visibleLimitAgents({ ...base, focused: 'gemini' })).toEqual(['claude', 'codex', 'gemini'])
    expect(visibleLimitAgents({ ...base, focused: 'shell' })).toEqual(['claude', 'codex'])
  })

  it('before the install check returns, shows only agents with readings or an account', () => {
    expect(visibleLimitAgents({ ...base, report: null })).toEqual([])
    expect(visibleLimitAgents({ ...base, report: null, withData: ['claude'], signedIn: ['codex'] })).toEqual(['claude', 'codex'])
  })

  it('falls back to data or an account for an agent the report does not mention', () => {
    expect(visibleLimitAgents({ ...base, report: [tool('claude', true)], withData: ['codex'] })).toEqual(['claude', 'codex'])
  })
})
