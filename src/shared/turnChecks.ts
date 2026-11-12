/** Checks that run after an agent's reply: what a project picked, what a run reports, and how failures read. */

export interface TurnChecksConfig {
  /** Ids of the project's run commands to run, in order. */
  commandIds: string[]
  /** Send failures to the agent without asking, up to MAX_AUTO_SENDS times in a row. */
  autoSend: boolean
}

export type TurnChecksSettings = Record<string, TurnChecksConfig>

export const MAX_CHECKS = 8
export const MAX_AUTO_SENDS = 2
export const OUTPUT_KEEP = 60_000
export const CHECKS_MESSAGE_PREFIX = 'These checks failed after your last reply'

export type CheckStatus = 'queued' | 'running' | 'passed' | 'failed'

export interface CheckResult {
  commandId: string
  /** What to show for the command, e.g. `npm test`. */
  display: string
  status: CheckStatus
  exitCode: number | null
  seconds: number
  /** "2 of 148 failed", or empty when the output gave no counts. */
  counts: string
  /** A few lines of the failing output. */
  excerpt: string
  /** The end of the output, for Show full output. */
  output: string
}

export interface CheckRunUpdate {
  runId: string
  sessionId: string
  results: CheckResult[]
  done: boolean
}

export const isConfigured = (config: TurnChecksConfig | undefined): config is TurnChecksConfig => !!config && config.commandIds.length > 0

/** Keeps only well-formed entries for projects that exist. */
export function sanitizeTurnChecks(raw: unknown, projectIds: readonly string[]): TurnChecksSettings {
  const out: TurnChecksSettings = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!projectIds.includes(id) || typeof entry !== 'object' || entry === null) continue
    const value = entry as Record<string, unknown>
    const ids = Array.isArray(value.commandIds) ? value.commandIds : []
    const commandIds = [...new Set(ids.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 512 && !item.includes('\0')))].slice(0, MAX_CHECKS)
    if (commandIds.length > 0) out[id] = { commandIds, autoSend: value.autoSend === true }
  }
  return out
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
export const stripAnsi = (text: string): string => text.replace(ANSI, '')

const COUNT_PATTERNS: ReadonlyArray<(text: string) => { failed: number; total: number } | null> = [
  // vitest: "Tests  2 failed | 146 passed (148)"
  (text) => {
    const m = /Tests\s+(?:(\d+) failed\s*\|\s*)?(?:(\d+) passed)?.*?\((\d+)\)/.exec(text)
    return m && m[1] ? { failed: Number(m[1]), total: Number(m[3]) } : null
  },
  // jest: "Tests:       2 failed, 146 passed, 148 total"
  (text) => {
    const m = /Tests:\s+(?:(\d+) failed,\s*)?(?:[^\n]*?)(\d+) total/.exec(text)
    return m && m[1] ? { failed: Number(m[1]), total: Number(m[2]) } : null
  },
  // dotnet: "Failed!  - Failed:     2, Passed:   146, Skipped:     0, Total:   148"
  (text) => {
    const m = /Failed:\s+(\d+),\s*Passed:\s+\d+,\s*Skipped:\s+\d+,\s*Total:\s+(\d+)/.exec(text)
    return m && Number(m[1]) > 0 ? { failed: Number(m[1]), total: Number(m[2]) } : null
  }
]

/** "2 of 148 failed" from jest, vitest or dotnet output; empty when the output has none of those summaries. */
export function failureCounts(output: string): string {
  const text = stripAnsi(output)
  for (const parse of COUNT_PATTERNS) {
    const found = parse(text)
    if (found && found.failed > 0) return `${found.failed} of ${found.total} failed`
  }
  return ''
}

const MARKER = /^\s*(?:✕|×|✗|FAIL\b|●|Failed\b|error\b|Error:|AssertionError|\d+\)\s)/
const EXCERPT_LINES = 6
const LINE_MAX = 160

const clip = (line: string): string => (line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)}…` : line)

/** A few lines worth reading: from the first failure marker, or else the last lines of the output. */
export function failureExcerpt(output: string): string {
  const lines = stripAnsi(output).replace(/\r/g, '').split('\n').map((line) => line.trimEnd())
  const kept = lines.filter((line, index) => line !== '' || (index > 0 && index < lines.length - 1))
  const start = kept.findIndex((line) => MARKER.test(line))
  const body = start >= 0 ? kept.slice(start, start + EXCERPT_LINES) : kept.filter((line) => line.trim() !== '').slice(-EXCERPT_LINES)
  return body.map(clip).join('\n').replace(/\s+$/, '')
}

export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return `${whole}s`
  const minutes = Math.floor(whole / 60)
  return `${minutes}m ${String(whole % 60).padStart(2, '0')}s`
}

/** The right-hand text of a check row. */
export function statusText(result: Pick<CheckResult, 'status' | 'seconds' | 'counts' | 'exitCode'>): string {
  const time = formatSeconds(result.seconds)
  if (result.status === 'queued') return 'waiting'
  if (result.status === 'running') return 'running…'
  if (result.status === 'passed') return `passed · ${time}`
  return `${result.counts || (result.exitCode === null ? 'could not run' : `failed, exit ${result.exitCode}`)} · ${time}`
}

export const failedChecks = (results: readonly CheckResult[]): CheckResult[] => results.filter((result) => result.status === 'failed')
export const checksFinished = (results: readonly CheckResult[]): boolean => results.length > 0 && results.every((result) => result.status === 'passed' || result.status === 'failed')

/** The message that sends failures back to the agent: short, with the lines that matter. */
export function failureMessage(results: readonly CheckResult[]): string {
  const failed = failedChecks(results)
  const parts = failed.map((result) => {
    const head = `${result.display}: ${result.counts || 'failed'}`
    return result.excerpt ? `${head}\n${result.excerpt}` : head
  })
  return `${CHECKS_MESSAGE_PREFIX}.\n\n${parts.join('\n\n')}\n\nPlease fix them.`
}

/** Whether a failed run should go to the agent by itself: the project allows it and fewer than two went out in a row. */
export const shouldAutoSend = (config: TurnChecksConfig | undefined, failedCount: number, streak: number): boolean =>
  !!config && config.autoSend && failedCount > 0 && streak < MAX_AUTO_SENDS

/** True when a user message is one of ours, so a reply to it continues a run of automatic sends. */
export const isFailureMessage = (text: string): boolean => text.trimStart().startsWith(CHECKS_MESSAGE_PREFIX)
