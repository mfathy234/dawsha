import { describe, expect, it } from 'vitest'
import { matchSignature, restoreResumeFlags, workspaceSessionFor } from '../../src/shared/sessionRestore'
import { snapshotWorkspace, type SnapshotPane } from '../../src/shared/layouts'

const tab = (id: string, agent: 'claude' | 'codex' | 'gemini' | 'shell', sessionId?: string) => ({ id, agent, label: agent, sessionId })

describe('workspaceSessionFor', () => {
  const matches = {
    claude: new Map([['t1', { sessionId: 'live-1' }], ['t2', { sessionId: 'live-2' }]]),
    codex: new Map([['t3', { sessionId: 'codex-live' }]]),
    gemini: undefined
  }
  const resolve = workspaceSessionFor(matches)

  it('saves the conversation each Claude pane is showing', () => {
    expect(resolve(tab('t1', 'claude'))).toBe('live-1')
    expect(resolve(tab('t2', 'claude'))).toBe('live-2')
  })

  it('prefers the live Claude conversation over the one the tab was resumed from, so /clear is kept', () => {
    expect(resolve(tab('t1', 'claude', 'resumed-old'))).toBe('live-1')
  })

  it('keeps a known Claude id while the session file is not matched yet', () => {
    expect(resolve(tab('t9', 'claude', 'resumed-old'))).toBe('resumed-old')
  })

  it('keeps Codex and Gemini ids the tab already has, and falls back to the match', () => {
    expect(resolve(tab('t3', 'codex', 'own'))).toBe('own')
    expect(resolve(tab('t3', 'codex'))).toBe('codex-live')
    expect(resolve(tab('t4', 'gemini', 'gem'))).toBe('gem')
  })

  it('gives every Claude pane its own id in the saved workspace', () => {
    const panes: SnapshotPane[] = ['t1', 't2'].map((id) => ({ id: `p-${id}`, projectId: 'p', fontSize: 14, activeTabId: id, tabs: [tab(id, 'claude')] }))
    const saved = snapshotWorkspace(panes, 'p-t1', { sessionFor: resolve })
    expect(saved.panes.map((pane) => pane.tabs[0].sessionId)).toEqual(['live-1', 'live-2'])
  })
})

describe('restoreResumeFlags', () => {
  it('resumes every tab that has a saved id', () => {
    expect(restoreResumeFlags([
      { agent: 'claude', sessionId: 'a', folder: 'C:/w' },
      { agent: 'claude', sessionId: 'b', folder: 'C:/w' },
      { agent: 'codex', sessionId: 'c', folder: 'C:/w' }
    ])).toEqual([true, true, true])
  })

  it('lets only one Claude tab per folder continue the latest conversation when ids are missing', () => {
    expect(restoreResumeFlags([
      { agent: 'claude', folder: 'C:/w' },
      { agent: 'claude', folder: 'C:/w' },
      { agent: 'claude', folder: 'C:/other' },
      { agent: 'claude', folder: 'c:\\w\\' }
    ])).toEqual([true, false, true, false])
  })

  it('starts a tab without an id fresh in a folder where another tab resumes by id', () => {
    expect(restoreResumeFlags([
      { agent: 'claude', folder: 'C:/w' },
      { agent: 'claude', sessionId: 'a', folder: 'C:/w' },
      { agent: 'claude', folder: 'C:/other' }
    ])).toEqual([false, true, true])
  })

  it('does not resume Codex, Gemini or shells without an id', () => {
    expect(restoreResumeFlags([
      { agent: 'codex', folder: 'C:/w' },
      { agent: 'gemini', folder: 'C:/w' },
      { agent: 'shell', folder: 'C:/w' }
    ])).toEqual([false, false, false])
  })
})

describe('matchSignature', () => {
  it('changes only when a tab is matched to a different conversation', () => {
    const a = matchSignature(new Map([['t1', { sessionId: 'x' }]]))
    expect(matchSignature(new Map([['t1', { sessionId: 'x' }]]))).toBe(a)
    expect(matchSignature(new Map([['t1', { sessionId: 'y' }]]))).not.toBe(a)
    expect(matchSignature(undefined)).toBe('')
  })
})
