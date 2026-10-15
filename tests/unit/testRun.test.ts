import { describe, expect, it } from 'vitest'
import { isTestCommand, parseTestCounts, testSummary } from '../../src/shared/testRun'

describe('isTestCommand', () => {
  it.each([
    'npm test',
    'npm run test:unit',
    'pnpm test -- --watch=false',
    'yarn test',
    'npx vitest run',
    'vitest',
    'npx jest --ci',
    'pytest -q tests/',
    'python -m pytest',
    'go test ./...',
    'cargo test --all',
    'dotnet test Foo.sln',
    'cd app && npm test',
    'npx playwright test tests/e2e/x.spec.ts'
  ])('detects %s', (command) => {
    expect(isTestCommand(command)).toBe(true)
  })

  it.each(['npm install', 'git status', 'echo pytest-cov', 'cat test.txt', 'npm run build', 'go build ./...'])('ignores %s', (command) => {
    expect(isTestCommand(command)).toBe(false)
  })
})

describe('parseTestCounts', () => {
  it('reads a vitest summary', () => {
    const out = ' Test Files  1 failed | 3 passed (4)\n      Tests  1 failed | 23 passed (24)\n'
    expect(parseTestCounts(out)).toEqual({ passed: 23, failed: 1 })
  })

  it('reads a jest summary', () => {
    expect(parseTestCounts('Test Suites: 2 passed, 2 total\nTests:       24 passed, 24 total\n')).toEqual({ passed: 24 })
  })

  it('reads a pytest summary with colour codes', () => {
    const esc = String.fromCharCode(27)
    expect(parseTestCounts(`${esc}[31m=== 2 failed, 10 passed in 1.2s ===${esc}[0m`)).toEqual({ passed: 10, failed: 2 })
  })

  it('sums cargo test results across crates', () => {
    const out = 'test result: ok. 5 passed; 0 failed; 0 ignored\ntest result: FAILED. 3 passed; 1 failed; 0 ignored\n'
    expect(parseTestCounts(out)).toEqual({ passed: 8, failed: 1 })
  })

  it('reads a dotnet summary', () => {
    expect(parseTestCounts('Failed!  - Failed:     1, Passed:    23, Skipped:     0, Total:    24')).toEqual({ passed: 23, failed: 1 })
  })

  it('counts go test packages and failures', () => {
    expect(parseTestCounts('ok  \tpkg/a\t0.2s\nok  \tpkg/b\t0.1s\nFAIL\tpkg/c\t0.3s\n')).toEqual({ passed: 2, failed: 1 })
    expect(parseTestCounts('--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.00s)\nFAIL\n')).toEqual({ passed: 1, failed: 1 })
  })

  it('returns null when there is no summary', () => {
    expect(parseTestCounts('compiling...\nerror: cannot find module')).toBeNull()
  })
})

describe('testSummary', () => {
  it('words the counts, hiding a zero failure count', () => {
    expect(testSummary({ passed: 23, failed: 1 }, false)).toBe('23 passed · 1 failed')
    expect(testSummary({ passed: 24, failed: 0 }, true)).toBe('24 passed')
    expect(testSummary({}, true)).toBe('passed')
    expect(testSummary({}, false)).toBe('failed')
  })
})
