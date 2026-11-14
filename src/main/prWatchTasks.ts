import {
  FAILED_MAX,
  PR_FIELDS,
  fixCiMessage,
  parseMergeCommand,
  parseWatchedPr,
  trimFailedLog,
  type PrFixLog,
  type PrFixResult,
  type PrMergeResult,
  type PrWatchCheck
} from '../shared/prWatch'
import { runGh as defaultRun, type GhRun } from './ghRunner'

type Runner = (cwd: string, args: readonly string[], timeout?: number) => Promise<GhRun>

const RUN_MAX = 3
const LOG_MS = 60_000
const MERGE_MS = 90_000
const MESSAGE_MAX = 9_000
const tail = (text: string): string => text.split('\n').filter(Boolean).slice(-3).join('\n').slice(0, 400)

const checkName = (check: PrWatchCheck): string => (check.workflow ? `${check.workflow} / ${check.name}` : check.name)

/** The logs of the failed runs behind some failed checks, trimmed, one entry per run. */
export async function failedLogs(folder: string, failed: readonly PrWatchCheck[], run: Runner = defaultRun): Promise<PrFixLog[]> {
  const byRun = new Map<string, PrWatchCheck[]>()
  const loose: PrWatchCheck[] = []
  for (const check of failed.slice(0, FAILED_MAX)) {
    if (!/^\d+$/.test(check.runId)) loose.push(check)
    else byRun.set(check.runId, [...(byRun.get(check.runId) ?? []), check])
  }
  const logs: PrFixLog[] = []
  for (const [runId, checks] of [...byRun.entries()].slice(0, RUN_MAX)) {
    const result = await run(folder, ['run', 'view', runId, '--log-failed'], LOG_MS)
    logs.push({ check: checks.map(checkName).join(', '), log: result.ok ? trimFailedLog(result.stdout) : '' })
  }
  for (const check of loose) logs.push({ check: checkName(check), log: '' })
  return logs
}

/** "CI failed on PR #34: ..." for the agent, from the failed checks of a pull request. */
export async function buildFixMessage(folder: string, number: number, failed: readonly PrWatchCheck[], run: Runner = defaultRun): Promise<PrFixResult> {
  if (!Number.isInteger(number) || number <= 0) return { ok: false, error: 'That is not a pull request number.' }
  if (failed.length === 0) return { ok: false, error: 'No check is failing.' }
  const logs = await failedLogs(folder, failed, run)
  const message = fixCiMessage(number, logs)
  return { ok: true, message: message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX)}...\n\nFix it and push.` : message }
}

/** Merges a pull request with the project's merge command, after reading it again: it must be open, on the commit the user saw, and ready. */
export async function mergeWatched(folder: string, request: { number: number; headSha: string; command: string }, run: Runner = defaultRun): Promise<PrMergeResult> {
  const parsed = parseMergeCommand(request.command, request.number, request.headSha)
  if (!parsed.ok) return parsed
  const view = await run(folder, ['pr', 'view', String(request.number), '--json', PR_FIELDS])
  const state = view.ok ? parseWatchedPr(view.stdout) : null
  if (!state || state.number !== request.number) return { ok: false, error: tail(view.message) || 'Could not read the pull request.' }
  if (state.state !== 'OPEN') return { ok: false, error: `PR #${state.number} is already ${state.state.toLowerCase()}.` }
  if (state.headSha.toLowerCase() !== request.headSha.toLowerCase()) return { ok: false, error: 'The branch changed since the checks passed. Waiting for the new checks.' }
  const ready = state.phase === 'ready' || (state.phase === 'waiting' && parsed.admin)
  if (!ready) return { ok: false, error: `PR #${state.number} is not ready to merge yet.` }
  const merged = await run(folder, parsed.args, MERGE_MS)
  return merged.ok ? { ok: true, message: `Merged PR #${state.number}.` } : { ok: false, error: tail(merged.message) || 'gh could not merge the pull request.' }
}
