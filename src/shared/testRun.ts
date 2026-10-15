export interface TestCounts {
  passed?: number
  failed?: number
}

const TEST_COMMAND =
  /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?|(?:(?:npx|bunx)\s+|pnpm\s+(?:exec\s+)?|yarn\s+)?(?:vitest|jest|mocha|playwright\s+test)|(?:python3?\s+-m\s+)?pytest|py\.test|go\s+test|cargo\s+test|dotnet\s+test)(?=$|[\s;&|)])/i

export const isTestCommand = (command: string): boolean => TEST_COMMAND.test(command)

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

const lastNumber = (text: string, pattern: RegExp): number | undefined => {
  let found: number | undefined
  for (const match of text.matchAll(pattern)) found = Number(match[1])
  return found
}

const sumNumbers = (text: string, pattern: RegExp): number | undefined => {
  let total: number | undefined
  for (const match of text.matchAll(pattern)) total = (total ?? 0) + Number(match[1])
  return total
}

function dotnet(text: string): TestCounts | null {
  const match = /Failed:\s*(\d+),\s*Passed:\s*(\d+)/.exec(text)
  return match ? { failed: Number(match[1]), passed: Number(match[2]) } : null
}

function cargo(text: string): TestCounts | null {
  const passed = sumNumbers(text, /(\d+) passed; \d+ failed/g)
  const failed = sumNumbers(text, /\d+ passed; (\d+) failed/g)
  return passed === undefined ? null : { passed, failed }
}

function goTest(text: string): TestCounts | null {
  const count = (pattern: RegExp): number => (text.match(pattern) ?? []).length
  const failed = count(/^--- FAIL:/gm) || count(/^FAIL\s/gm)
  const passed = count(/^--- PASS:/gm) || count(/^ok\s/gm)
  return passed + failed === 0 ? null : { passed, failed }
}

function generic(text: string): TestCounts | null {
  const summary = text.split('\n').filter((line) => /^\s*Tests?\b/i.test(line))
  const scope = summary.length > 0 ? summary.join('\n') : text
  const passed = lastNumber(scope, /(\d+)\s+(?:passed|passing)/gi)
  const failed = lastNumber(scope, /(\d+)\s+(?:failed|failing)/gi)
  return passed === undefined && failed === undefined ? null : { passed, failed }
}

/** Pass and fail counts from a test runner's output, or null when the output has no summary. */
export function parseTestCounts(output: string): TestCounts | null {
  const text = output.replace(ANSI, '')
  const counts = dotnet(text) ?? cargo(text) ?? generic(text) ?? goTest(text)
  if (!counts) return null
  const out: TestCounts = {}
  if (counts.passed !== undefined) out.passed = counts.passed
  if (counts.failed !== undefined) out.failed = counts.failed
  return out
}

export function testSummary(counts: TestCounts, ok: boolean | undefined): string {
  const parts: string[] = []
  if (counts.passed !== undefined) parts.push(`${counts.passed} passed`)
  if (counts.failed !== undefined && counts.failed > 0) parts.push(`${counts.failed} failed`)
  if (parts.length > 0) return parts.join(' · ')
  return ok === undefined ? 'ran' : ok ? 'passed' : 'failed'
}
