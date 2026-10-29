import { describe, expect, it } from 'vitest'
import { latestRuns, problemLine, problemsMessage, runProblems } from '../../src/renderer/files/problemsPane'
import type { RunSnapshot } from '../../src/shared/runCommands'

const run = (over: Partial<RunSnapshot>): RunSnapshot => ({
  id: 'r1', commandId: 'build', name: 'build', projectId: 'p', folder: '/repo', cwd: '/repo/app', display: 'npm run build', status: 'exited', output: '', exitCode: 1, startedAt: 1, ...over
})

describe('latestRuns', () => {
  it('keeps the newest run of each command in this checkout only', () => {
    const runs = [run({ id: 'a' }), run({ id: 'b' }), run({ id: 'c', commandId: 'test' }), run({ id: 'd', folder: '/other' })]
    expect(latestRuns(runs, '/repo').map((r) => r.id)).toEqual(['b', 'c'])
  })
})

describe('runProblems', () => {
  it('places files against the run working directory and leaves outside files unlinked', () => {
    const problems = runProblems(run({ output: 'src/a.ts(3,1): error TS1: bad\n/elsewhere/b.ts(1,1): error TS1: worse\n' }))
    expect(problems.map((p) => p.path)).toEqual(['app/src/a.ts', null])
  })
  it('takes the first test frame inside the checkout', () => {
    const output = ' FAIL  t > x\nError: no\n ❯ /elsewhere/lib.ts:1:1\n ❯ /repo/app/t.test.ts:2:2\n'
    expect(runProblems(run({ output }))).toEqual([expect.objectContaining({ path: 'app/t.test.ts', line: 2 })])
  })
})

describe('what is sent to an agent', () => {
  const [one, two] = runProblems(run({ output: 'src/a.ts(3,1): error TS2322: bad\n/elsewhere/b.ts(1,1): warning TS6133: unused\n' }))
  it('mentions a project file with its line and the outside file by its path', () => {
    expect(problemLine(one)).toBe('@app/src/a.ts#L3 error TS2322: bad')
    expect(problemLine(two)).toBe('/elsewhere/b.ts:1 warning TS6133: unused')
  })
  it('sends one problem as a sentence and several as a list, without submitting', () => {
    expect(problemsMessage([one])).toBe('Fix this problem from the run:\n@app/src/a.ts#L3 error TS2322: bad ')
    expect(problemsMessage([one, two])).toBe('Fix these problems from the run:\n- @app/src/a.ts#L3 error TS2322: bad\n- /elsewhere/b.ts:1 warning TS6133: unused ')
    expect(problemsMessage([one, two]).endsWith('\n')).toBe(false)
  })
  it('caps a long list and says how many were left out', () => {
    const many = Array.from({ length: 60 }, () => one)
    const message = problemsMessage(many)
    expect(message.split('\n- ')).toHaveLength(51)
    expect(message).toContain('(and 10 more)')
  })
})
