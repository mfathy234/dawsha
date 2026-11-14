import { formatDuration } from './sessionCost'
import { formatUsd } from './usage'
import { activeMs, type WorkItem, type WorkReport } from './workDashboard'
import type { AgentKind } from './types'

/** What a session changed in git while it worked: distinct files, and lines added and removed. */
export interface RecapChange {
  files: number
  added: number
  removed: number
}

/** Today's report plus the git change counts read for each session in it, keyed by item id. */
export interface WorkRecapData {
  report: WorkReport
  changes: Record<string, RecapChange>
}

export interface RecapRow {
  id: string
  agent: AgentKind
  title: string
  project: string
  activeMs: number
  files: number
  added: number
  removed: number
  costUsd: number | null
}

export interface TodayRecap {
  rows: RecapRow[]
  totalMs: number
  totalFiles: number
  totalAdded: number
  totalRemoved: number
  totalCostUsd: number | null
}

const NONE: RecapChange = { files: 0, added: 0, removed: 0 }

/** Sums `git log --numstat` output: files are counted once however many commits touched them. */
export function parseNumstat(text: string): RecapChange {
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  for (const line of text.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.replace(/\r$/, ''))
    if (!match) continue
    paths.add(match[3])
    added += match[1] === '-' ? 0 : Number(match[1])
    removed += match[2] === '-' ? 0 : Number(match[2])
  }
  return { files: paths.size, added, removed }
}

/** One row for each session that was active in the window, the longest first, with the totals under them. */
export function buildTodayRecap(data: WorkRecapData | null, now: number, costOf: (item: WorkItem) => number | null): TodayRecap {
  const empty: TodayRecap = { rows: [], totalMs: 0, totalFiles: 0, totalAdded: 0, totalRemoved: 0, totalCostUsd: null }
  if (!data) return empty
  const end = Math.min(data.report.end, now)
  const rows = data.report.items
    .map((item): RecapRow => {
      const change = data.changes[item.id] ?? NONE
      return { id: item.id, agent: item.agent, title: item.title, project: item.project, activeMs: activeMs(item, data.report.start, end), ...change, costUsd: costOf(item) }
    })
    .filter((row) => row.activeMs > 0)
    .sort((a, b) => b.activeMs - a.activeMs || a.id.localeCompare(b.id))
  const costs = rows.map((row) => row.costUsd).filter((cost): cost is number => cost !== null && cost > 0)
  return {
    rows,
    totalMs: rows.reduce((sum, row) => sum + row.activeMs, 0),
    totalFiles: rows.reduce((sum, row) => sum + row.files, 0),
    totalAdded: rows.reduce((sum, row) => sum + row.added, 0),
    totalRemoved: rows.reduce((sum, row) => sum + row.removed, 0),
    totalCostUsd: costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0)
  }
}

const filesText = (files: number): string => `${files} file${files === 1 ? '' : 's'}`

/** "Today: Fixed the restore bug in Platforms (40m, 3 files), Wrote the docs in Dawsha (12m). Total 52m, 3 files, $1.20." */
export function formatRecapText(recap: TodayRecap): string {
  if (recap.rows.length === 0) return 'Today: nothing yet.'
  const parts = recap.rows.map((row) => {
    const facts = [formatDuration(row.activeMs), ...(row.files > 0 ? [filesText(row.files)] : [])]
    return `${row.title} in ${row.project} (${facts.join(', ')})`
  })
  const total = [formatDuration(recap.totalMs), ...(recap.totalFiles > 0 ? [filesText(recap.totalFiles)] : []), ...(recap.totalCostUsd !== null ? [formatUsd(recap.totalCostUsd)] : [])]
  return `Today: ${parts.join(', ')}. Total ${total.join(', ')}.`
}
