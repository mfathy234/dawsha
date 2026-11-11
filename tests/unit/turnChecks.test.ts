import { describe, expect, it } from 'vitest'
import {
  CHECKS_MESSAGE_PREFIX,
  checksFinished,
  failureCounts,
  failureExcerpt,
  failureMessage,
  formatSeconds,
  isFailureMessage,
  sanitizeTurnChecks,
  shouldAutoSend,
  statusText,
  type CheckResult
} from '../../src/shared/turnChecks'

const result = (patch: Partial<CheckResult>): CheckResult => ({ commandId: 'npm:test', display: 'npm test', status: 'failed', exitCode: 1, seconds: 38, counts: '', excerpt: '', output: '', ...patch })

describe('failureCounts', () => {
  it('reads vitest', () => {
    expect(failureCounts(' Test Files  1 failed | 9 passed (10)\n      Tests  2 failed | 146 passed (148)')).toBe('2 of 148 failed')
  })

  it('reads jest', () => {
    expect(failureCounts('Tests:       2 failed, 146 passed, 148 total\nTime: 3 s')).toBe('2 of 148 failed')
  })

  it('reads dotnet', () => {
    expect(failureCounts('Failed!  - Failed:     2, Passed:   146, Skipped:     0, Total:   148, Duration: 5 s')).toBe('2 of 148 failed')
  })

  it('ignores colour codes and passing summaries', () => {
    expect(failureCounts('\u001b[31mTests  1 failed | 4 passed (5)\u001b[39m')).toBe('1 of 5 failed')
    expect(failureCounts('Tests  24 passed (24)')).toBe('')
    expect(failureCounts('Passed!  - Failed:     0, Passed:   146, Skipped:     0, Total:   146')).toBe('')
    expect(failureCounts('something else')).toBe('')
  })
})

describe('failureExcerpt', () => {
  it('starts at the first failure marker', () => {
    const output = ['> test', '', 'RUN  v1', '  ✓ ok', '  ✕ parseDate › keeps an explicit offset', '    Expected: 08:00', '    Received: 10:00', 'more'].join('\n')
    expect(failureExcerpt(output).split('\n')).toEqual(['  ✕ parseDate › keeps an explicit offset', '    Expected: 08:00', '    Received: 10:00', 'more'])
  })

  it('shows the last lines when nothing looks like a failure', () => {
    const output = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const lines = failureExcerpt(output).split('\n')
    expect(lines).toHaveLength(6)
    expect(lines[5]).toBe('line 19')
  })

  it('clips long lines and strips colour', () => {
    expect(failureExcerpt(`\u001b[31mError: ${'x'.repeat(400)}\u001b[0m`).length).toBeLessThan(170)
  })
})

describe('status text', () => {
  it('formats the time', () => {
    expect(formatSeconds(6)).toBe('6s')
    expect(formatSeconds(72)).toBe('1m 12s')
    expect(formatSeconds(125.4)).toBe('2m 05s')
  })

  it('says what each state is', () => {
    expect(statusText(result({ status: 'running' }))).toBe('running…')
    expect(statusText(result({ status: 'queued' }))).toBe('waiting')
    expect(statusText(result({ status: 'passed', seconds: 6, exitCode: 0 }))).toBe('passed · 6s')
    expect(statusText(result({ counts: '2 of 148 failed' }))).toBe('2 of 148 failed · 38s')
    expect(statusText(result({ exitCode: 2 }))).toBe('failed, exit 2 · 38s')
    expect(statusText(result({ exitCode: null }))).toBe('could not run · 38s')
  })

  it('knows when every check is done', () => {
    expect(checksFinished([])).toBe(false)
    expect(checksFinished([result({}), result({ status: 'running' })])).toBe(false)
    expect(checksFinished([result({}), result({ status: 'passed' })])).toBe(true)
  })
})

describe('sending failures', () => {
  it('lists only the failed checks with their lines', () => {
    const text = failureMessage([result({ display: 'npm run lint', status: 'passed' }), result({ counts: '2 of 148 failed', excerpt: '✕ a › b' })])
    expect(text.startsWith(CHECKS_MESSAGE_PREFIX)).toBe(true)
    expect(text).toContain('npm test: 2 of 148 failed\n✕ a › b')
    expect(text).not.toContain('npm run lint')
    expect(isFailureMessage(text)).toBe(true)
    expect(isFailureMessage('please fix it')).toBe(false)
  })

  it('goes out by itself at most twice in a row and only when the project allows it', () => {
    const on = { commandIds: ['a'], autoSend: true }
    expect(shouldAutoSend(on, 1, 0)).toBe(true)
    expect(shouldAutoSend(on, 1, 1)).toBe(true)
    expect(shouldAutoSend(on, 1, 2)).toBe(false)
    expect(shouldAutoSend(on, 0, 0)).toBe(false)
    expect(shouldAutoSend({ ...on, autoSend: false }, 1, 0)).toBe(false)
    expect(shouldAutoSend(undefined, 1, 0)).toBe(false)
  })
})

describe('sanitizeTurnChecks', () => {
  it('keeps well-formed entries for known projects', () => {
    expect(sanitizeTurnChecks({ p1: { commandIds: ['a', 'a', 'b'], autoSend: true }, p2: { commandIds: ['c'] } }, ['p1', 'p2'])).toEqual({
      p1: { commandIds: ['a', 'b'], autoSend: true },
      p2: { commandIds: ['c'], autoSend: false }
    })
  })

  it('drops unknown projects, empty lists and junk', () => {
    expect(sanitizeTurnChecks({ gone: { commandIds: ['a'] }, p1: { commandIds: [] }, p2: { commandIds: [1, '', 'x\0y'] }, p3: 'no' }, ['p1', 'p2', 'p3'])).toEqual({})
    expect(sanitizeTurnChecks(null, ['p1'])).toEqual({})
    expect(sanitizeTurnChecks([], ['p1'])).toEqual({})
  })

  it('keeps at most eight commands', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`)
    expect(sanitizeTurnChecks({ p1: { commandIds: ids } }, ['p1']).p1.commandIds).toHaveLength(8)
  })
})
