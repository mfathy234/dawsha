import { describe, expect, it } from 'vitest'
import { miniSession } from '../../src/shared/miniWindow'
import { sanitizePrSettings } from '../../src/shared/prSettings'
import {
  fixCiMessage,
  findPrUrl,
  parseMergeCommand,
  parseWatchedPr,
  pollDelayMs,
  prLine,
  prNotice,
  shouldAutoFix,
  shouldMerge,
  shouldTidy,
  tidyIsStrict,
  tidyNote,
  trimFailedLog,
  worthLooking,
  type PrWatchState
} from '../../src/shared/prWatch'
import { sessionLine } from '../../src/shared/sessionLine'

const SHA = 'a'.repeat(40)
const run = (name: string, conclusion: string, url = `https://github.com/o/r/actions/runs/${name.length}1/job/2`) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion, detailsUrl: url })
const pr = (over: Record<string, unknown> = {}): string => JSON.stringify({ number: 34, title: 'Add it', url: 'https://github.com/o/r/pull/34', state: 'OPEN', isDraft: false, mergeStateStatus: 'CLEAN', reviewDecision: '', headRefOid: SHA, headRefName: 'feature/x', baseRefName: 'main', statusCheckRollup: [run('build', 'SUCCESS')], ...over })
const read = (over: Record<string, unknown> = {}): PrWatchState => parseWatchedPr(pr(over)) as PrWatchState

describe('parseWatchedPr', () => {
  it('reads every phase from gh json', () => {
    expect(read().phase).toBe('ready')
    expect(read({ statusCheckRollup: [run('build', 'SUCCESS'), { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: '' }] }).phase).toBe('running')
    expect(read({ statusCheckRollup: [run('build', 'FAILURE'), run('lint', 'FAILURE'), run('t', 'SUCCESS')] })).toMatchObject({ phase: 'failed', failedCount: 2, passed: 1 })
    expect(read({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/x', state: 'ERROR', targetUrl: '' }] }).phase).toBe('failed')
    expect(read({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/x', state: 'PENDING' }] }).phase).toBe('running')
    expect(read({ state: 'MERGED' }).phase).toBe('merged')
    expect(read({ state: 'CLOSED' }).phase).toBe('closed')
    expect(read({ isDraft: true }).phase).toBe('draft')
    expect(read({ mergeStateStatus: 'DIRTY' }).phase).toBe('conflicts')
    expect(read({ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }).phase).toBe('waiting')
    expect(read({ statusCheckRollup: [] }).phase).toBe('ready')
  })
  it('keeps the run id of a failed check and ignores skipped ones', () => {
    const state = read({ statusCheckRollup: [run('build', 'FAILURE', 'https://github.com/o/r/actions/runs/98765/job/1'), run('skip', 'SKIPPED')] })
    expect(state.failed[0]).toMatchObject({ name: 'build', runId: '98765' })
    expect(state.phase).toBe('failed')
  })
  it('rejects things that are not a pull request', () => {
    expect(parseWatchedPr('nope')).toBeNull()
    expect(parseWatchedPr('{"number":"x"}')).toBeNull()
  })
})

describe('prLine', () => {
  it('words each state', () => {
    expect(prLine(read({ statusCheckRollup: [{ __typename: 'CheckRun', status: 'QUEUED', name: 'a' }] }))).toBe('PR #34: checks running')
    expect(prLine(read({ statusCheckRollup: [run('a', 'FAILURE'), run('bb', 'FAILURE')] }))).toBe('PR #34: checks failed (2)')
    expect(prLine(read())).toBe('PR #34: ready to merge')
    expect(prLine(read({ state: 'MERGED' }))).toBe('PR #34: merged')
    expect(prLine(read({ state: 'CLOSED' }))).toBe('PR #34: closed')
    expect(prLine(read({ mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED' }))).toBe('PR #34: changes requested')
    expect(prLine(read({ mergeStateStatus: 'BLOCKED' }))).toBe('PR #34: waiting for review')
  })
  it('shows in the sidebar line and the Mini line only when the session is not working', () => {
    const base = { state: 'idle' as const, ask: '', recap: '', tool: '', plan: '', changed: 2, agents: 0, pr: 'PR #34: ready to merge' }
    expect(sessionLine(base)).toBe('PR #34: ready to merge')
    expect(sessionLine({ ...base, state: 'done' })).toBe('Done · PR #34: ready to merge')
    expect(sessionLine({ ...base, state: 'working' })).toBe('Working')
    const mini = { paneId: 'p', agent: 'claude' as const, title: 't', project: 'x', status: 'idle' as const, attention: 'none' as const, tail: '', recap: '', tool: '', idleFor: '', changed: null, todos: [] }
    expect(miniSession({ ...mini, pr: 'PR #34: merged' }).line).toBe('PR #34: merged')
  })
})

describe('findPrUrl', () => {
  it('takes the newest pull request link in the output', () => {
    expect(findPrUrl('see https://github.com/o/r/pull/7\nthen https://github.com/o/r/pull/9 done')).toEqual({ number: 9, url: 'https://github.com/o/r/pull/9' })
    expect(findPrUrl('https://dev.azure.com/org/p/_git/r/pullrequest/12')?.number).toBe(12)
    expect(findPrUrl('nothing here')).toBeNull()
  })
})

describe('pollDelayMs', () => {
  it('is 60 s visible, slower hidden, and backs off after failures up to a cap', () => {
    expect(pollDelayMs({ visible: true, failures: 0 })).toBe(60_000)
    expect(pollDelayMs({ visible: false, failures: 0 })).toBe(300_000)
    expect(pollDelayMs({ visible: true, failures: 2 })).toBe(240_000)
    expect(pollDelayMs({ visible: true, failures: 20 })).toBe(600_000)
  })
})

describe('trimFailedLog', () => {
  const log = ['build\tTest\t2026-01-01T10:00:00.0000000Z \u001b[31mstarting\u001b[0m', ...Array.from({ length: 100 }, (_, i) => `build\tTest\t2026-01-01T10:00:01.0000000Z noise line ${i}`), 'build\tTest\t2026-01-01T10:00:02.0000000Z FAIL tests/a.test.ts', 'build\tTest\t2026-01-01T10:00:02.0000000Z   expected 1 to be 2', 'build\tTest\t2026-01-01T10:00:03.0000000Z done'].join('\n')
  it('keeps the failure lines with context and drops colours and timestamps', () => {
    const out = trimFailedLog(log)
    expect(out).toContain('FAIL tests/a.test.ts')
    expect(out).toContain('expected 1 to be 2')
    expect(out).not.toContain('2026-01-01')
    expect(out).not.toContain('\u001b')
    expect(out).not.toContain('noise line 5')
    expect(out.split('\n').length).toBeLessThanOrEqual(40)
  })
  it('falls back to the last lines and caps the size', () => {
    const plain = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    expect(trimFailedLog(plain).split('\n')).toHaveLength(40)
    expect(trimFailedLog('x'.repeat(10_000)).length).toBeLessThanOrEqual(2503)
    expect(trimFailedLog('')).toBe('')
  })
  it('builds the one message for the agent', () => {
    const text = fixCiMessage(34, [{ check: 'CI / build', log: 'FAIL a' }, { check: 'CI / lint', log: '' }])
    expect(text.startsWith('CI failed on PR #34: CI / build: FAIL a')).toBe(true)
    expect(text).toContain('CI / lint: no log was available.')
    expect(text.endsWith('Fix it and push.')).toBe(true)
  })
})

describe('once-per-commit auto fix', () => {
  const failed = read({ statusCheckRollup: [run('build', 'FAILURE')] })
  it('fires once for a failing commit, again for a new one, and waits for running checks', () => {
    expect(shouldAutoFix({ enabled: true, state: failed, lastFixedSha: null })).toBe(true)
    expect(shouldAutoFix({ enabled: true, state: failed, lastFixedSha: SHA })).toBe(false)
    expect(shouldAutoFix({ enabled: true, state: { ...failed, headSha: 'b'.repeat(40) }, lastFixedSha: SHA })).toBe(true)
    expect(shouldAutoFix({ enabled: false, state: failed, lastFixedSha: null })).toBe(false)
    expect(shouldAutoFix({ enabled: true, state: { ...failed, pending: 1 }, lastFixedSha: null })).toBe(false)
    expect(shouldAutoFix({ enabled: true, state: read(), lastFixedSha: null })).toBe(false)
  })
})

describe('merge command and merge when green', () => {
  it('turns the default and an admin command into gh arguments', () => {
    expect(parseMergeCommand('', 34, SHA)).toEqual({ ok: true, args: ['pr', 'merge', '34', '--squash', `--match-head-commit=${SHA}`], admin: false })
    expect(parseMergeCommand('gh pr merge <n> --squash --admin', 34, SHA)).toMatchObject({ ok: true, admin: true })
    expect(parseMergeCommand('gh pr merge --squash', 5, '')).toEqual({ ok: true, args: ['pr', 'merge', '5', '--squash'], admin: false })
  })
  it('refuses anything that is not a plain gh pr merge', () => {
    for (const bad of ['rm -rf /', 'gh pr merge <n> --squash; rm x', 'gh pr merge <n> $(x)', 'gh pr merge 9 --squash', 'gh pr merge <n> --repo a/b', 'gh pr merge <n> --repo=a/b', 'gh pr merge <n> -Rowner/repo', 'gh pr merge <n> -R owner/repo', 'gh pr close <n>']) {
      expect(parseMergeCommand(bad, 34, SHA).ok).toBe(false)
    }
  })
  it('merges when ready, and a blocked review only with --admin', () => {
    const ready = read()
    expect(shouldMerge({ enabled: true, state: ready, admin: false, lastTriedSha: null })).toBe(true)
    expect(shouldMerge({ enabled: false, state: ready, admin: false, lastTriedSha: null })).toBe(false)
    expect(shouldMerge({ enabled: true, state: ready, admin: false, lastTriedSha: SHA })).toBe(false)
    const blocked = read({ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' })
    expect(shouldMerge({ enabled: true, state: blocked, admin: false, lastTriedSha: null })).toBe(false)
    expect(shouldMerge({ enabled: true, state: blocked, admin: true, lastTriedSha: null })).toBe(true)
    expect(shouldMerge({ enabled: true, state: read({ statusCheckRollup: [run('a', 'FAILURE')] }), admin: true, lastTriedSha: null })).toBe(false)
    expect(shouldMerge({ enabled: true, state: read({ state: 'MERGED' }), admin: true, lastTriedSha: null })).toBe(false)
  })
})

describe('tidy up and notices', () => {
  it('tidies a merged or closed pull request only when the project asked', () => {
    expect(shouldTidy({ enabled: true, state: read({ state: 'MERGED' }) })).toBe(true)
    expect(shouldTidy({ enabled: true, state: read({ state: 'CLOSED' }) })).toBe(true)
    expect(shouldTidy({ enabled: true, state: read() })).toBe(false)
    expect(shouldTidy({ enabled: false, state: read({ state: 'MERGED' }) })).toBe(false)
    expect(tidyIsStrict(false)).toBe(true)
    expect(tidyIsStrict(true)).toBe(false)
    expect(tidyNote(read({ state: 'MERGED' }))).toBe('Merged as PR #34')
  })
  it('notifies on failed, ready and merged, once per change', () => {
    expect(prNotice('running', read({ statusCheckRollup: [run('build', 'FAILURE')] }))?.title).toBe('Checks failed on PR #34')
    expect(prNotice('running', read())?.title).toBe('PR #34 is ready to merge')
    expect(prNotice('ready', read({ state: 'MERGED' }))?.title).toBe('PR #34 was merged')
    expect(prNotice('ready', read())).toBeNull()
    expect(prNotice('running', read({ statusCheckRollup: [{ status: 'QUEUED', name: 'a' }] }))).toBeNull()
  })
  it('looks only at branches that are not the default', () => {
    expect(worthLooking('feature/x')).toBe(true)
    expect(worthLooking('main')).toBe(false)
    expect(worthLooking(null)).toBe(false)
  })
})

describe('sanitizePrSettings', () => {
  it('keeps known projects and drops the rest', () => {
    const out = sanitizePrSettings({ a: { mergeCommand: ' gh  pr merge <n> --squash ', mergeConfirmed: true, tidyUp: true }, gone: { tidyUp: true }, b: 5 }, new Set(['a', 'b']))
    expect(out).toEqual({ a: { mergeCommand: 'gh pr merge <n> --squash', mergeConfirmed: true, tidyUp: true } })
    expect(sanitizePrSettings(null, new Set())).toEqual({})
  })
})
