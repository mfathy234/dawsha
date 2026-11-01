import { describe, expect, it } from 'vitest'
import {
  baseProblem, classifyGhFailure, failedChecks, feedbackMessage, mergeCopy, parseChecks, parsePrInfo, parseReviewComments, parseReviewSummaries, requestProblem, titleProblem
} from '../../src/shared/prFlow'

const SHA = 'a'.repeat(40)

describe('parsePrInfo', () => {
  it('reads gh pr view json', () => {
    const pr = parsePrInfo(JSON.stringify({ number: 12, title: 'Fix it', url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: true, baseRefName: 'main', headRefName: 'fix', headRefOid: SHA, mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED' }))
    expect(pr).toMatchObject({ number: 12, state: 'OPEN', isDraft: true, base: 'main', head: 'fix', headSha: SHA, mergeable: 'CONFLICTING' })
  })

  it('returns null for anything that is not a pull request', () => {
    expect(parsePrInfo('not json')).toBeNull()
    expect(parsePrInfo('{"number":"3"}')).toBeNull()
    expect(parsePrInfo('[]')).toBeNull()
  })
})

describe('parseChecks', () => {
  it('keeps name, workflow, bucket and link', () => {
    const checks = parseChecks(JSON.stringify([{ name: 'build', workflow: 'CI', bucket: 'fail', link: 'https://x/1' }, { name: 'lint', bucket: 'weird' }, { workflow: 'no name' }]))
    expect(checks).toEqual([{ name: 'build', workflow: 'CI', bucket: 'fail', link: 'https://x/1' }, { name: 'lint', workflow: '', bucket: 'pending', link: '' }])
    expect(failedChecks(checks).map((check) => check.name)).toEqual(['build'])
    expect(parseChecks('garbage')).toEqual([])
  })
})

describe('parseReviewComments', () => {
  it('reads line comments and marks the ones whose line is gone as outdated', () => {
    const comments = parseReviewComments(JSON.stringify([
      { id: 1, user: { login: 'ann' }, body: 'rename this', path: 'src/a.ts', line: 14, html_url: 'https://x/c1' },
      { id: 2, user: { login: 'bob' }, body: 'old', path: 'src/b.ts', line: null, original_line: 7, html_url: '' },
      { id: 3, user: { login: 'cy' }, body: '', path: 'x', line: 1 }
    ]))
    expect(comments).toHaveLength(2)
    expect(comments[0]).toMatchObject({ author: 'ann', path: 'src/a.ts', line: 14, outdated: false })
    expect(comments[1]).toMatchObject({ line: 7, outdated: true })
    expect(parseReviewComments('{}')).toEqual([])
  })

  it('reads review summaries with a body', () => {
    const summaries = parseReviewSummaries(JSON.stringify({ reviews: [{ author: { login: 'dee' }, state: 'CHANGES_REQUESTED', body: 'needs tests' }, { author: { login: 'eve' }, body: '' }] }))
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ author: 'dee', path: null })
  })
})

describe('classifyGhFailure', () => {
  it('tells the states apart', () => {
    expect(classifyGhFailure('no pull requests found for branch "x"')).toBe('no-pr')
    expect(classifyGhFailure('You are not logged into any GitHub hosts. To log in, run: gh auth login')).toBe('signed-out')
    expect(classifyGhFailure('none of the git remotes configured for this repository point to a known GitHub host')).toBe('no-remote')
    expect(classifyGhFailure('fatal: not a git repository')).toBe('not-repo')
    expect(classifyGhFailure('something else broke')).toBeNull()
  })
})

describe('request validation', () => {
  it('checks titles', () => {
    expect(titleProblem('Fix the thing')).toBeNull()
    expect(titleProblem('')).not.toBeNull()
    expect(titleProblem('two\nlines')).not.toBeNull()
    expect(titleProblem('x'.repeat(300))).not.toBeNull()
    expect(titleProblem(5)).not.toBeNull()
  })

  it('checks base branch names, so no flag can be smuggled in', () => {
    expect(baseProblem('')).toBeNull()
    expect(baseProblem('main')).toBeNull()
    expect(baseProblem('release/1.8')).toBeNull()
    for (const bad of ['--web', '-x', 'a..b', 'a b', 'x;y', 'a/', 'a.lock', '$(x)']) expect(baseProblem(bad), bad).not.toBeNull()
  })

  it('checks create and merge requests as a whole', () => {
    expect(requestProblem({ folder: 'f', action: 'overview' })).toBeNull()
    expect(requestProblem({ folder: 'f', action: 'create', title: 'T', body: '', base: 'main', draft: false })).toBeNull()
    expect(requestProblem({ folder: 'f', action: 'create', title: 'T', body: '', base: '--x', draft: false })).not.toBeNull()
    expect(requestProblem({ folder: 'f', action: 'merge', number: 3, headSha: SHA, method: 'squash' })).toBeNull()
    expect(requestProblem({ folder: 'f', action: 'merge', number: 0, headSha: SHA, method: 'squash' })).not.toBeNull()
    expect(requestProblem({ folder: 'f', action: 'merge', number: 3, headSha: 'abc', method: 'squash' })).not.toBeNull()
    expect(requestProblem({ folder: 'f', action: 'merge', number: 3, headSha: SHA, method: 'force' as 'squash' })).not.toBeNull()
  })
})

describe('messages', () => {
  it('builds the agent prompt from comments and failing checks', () => {
    const text = feedbackMessage({ number: 9, title: 'Add config tab' }, [
      { id: 1, author: 'ann', body: 'rename\nthis', path: 'src/a.ts', line: 4, url: '', outdated: false },
      { id: -1, author: 'dee', body: 'needs tests', path: null, line: null, url: '', outdated: false }
    ], [{ name: 'build', workflow: 'CI', bucket: 'fail', link: 'https://x/1' }])
    expect(text).toContain('#9 (Add config tab)')
    expect(text).toContain('- @src/a.ts#L4 ann: rename this')
    expect(text).toContain('- dee: needs tests')
    expect(text).toContain('- CI / build (https://x/1)')
  })

  it('names the pull request on the message and the button when merging', () => {
    const copy = mergeCopy({ number: 9, title: 'Add config tab', base: 'main' }, 'squash')
    expect(copy.body).toContain('#9 Add config tab')
    expect(copy.body).toContain('main')
    expect(copy.confirmLabel).toBe('Merge #9 Add config tab')
  })
})
