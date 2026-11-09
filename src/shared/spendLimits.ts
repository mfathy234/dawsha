import type { SessionCost } from './usage'
import type { Project } from './types'

export type SpendPeriod = 'day' | 'week'
export interface SpendLimit { amountUsd: number; period: SpendPeriod }
export interface SpendProject extends Pick<Project, 'id' | 'folder'> { limit: SpendLimit }
export type SpendThreshold = 80 | 100
export interface SpendWarning { projectId: string; threshold: SpendThreshold; spentUsd: number; limit: SpendLimit; periodKey: string }
export type SpendWarned = Readonly<Record<string, SpendThreshold[]>>

export function spendPeriodKey(at: number, period: SpendPeriod): string {
  const date = new Date(at)
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (period === 'day') return day
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

function projectFor(cwd: string | null, projects: readonly SpendProject[]): string | null {
  if (!cwd) return null
  const path = cwd.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  const match = [...projects].sort((a, b) => b.folder.length - a.folder.length).find(({ folder }) => {
    const root = folder.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
    return path === root || path.startsWith(`${root}/`)
  })
  return match?.id ?? null
}

export function spendTotals(projects: readonly SpendProject[], costs: readonly SessionCost[], now: number): Readonly<Record<string, number>> {
  return costs.reduce<Record<string, number>>((totals, cost) => {
    const id = projectFor(cost.cwd, projects)
    const project = projects.find((item) => item.id === id)
    if (!project || cost.at > now || spendPeriodKey(cost.at, project.limit.period) !== spendPeriodKey(now, project.limit.period)) return totals
    return { ...totals, [project.id]: (totals[project.id] ?? 0) + cost.usd }
  }, {})
}

export function detectSpendWarnings(projects: readonly SpendProject[], totals: Readonly<Record<string, number>>, now: number, warned: SpendWarned): { fire: SpendWarning[]; warned: SpendWarned } {
  let next = warned
  const fire = projects.flatMap((project) => {
    const spentUsd = totals[project.id] ?? 0
    const periodKey = spendPeriodKey(now, project.limit.period)
    const prior = warned[`${project.id}:${periodKey}`] ?? []
    const thresholds = ([80, 100] as const).filter((threshold) => spentUsd >= project.limit.amountUsd * threshold / 100 && !prior.includes(threshold))
    if (thresholds.length) next = { ...next, [`${project.id}:${periodKey}`]: [...prior, ...thresholds] }
    return thresholds.map((threshold) => ({ projectId: project.id, threshold, spentUsd, limit: project.limit, periodKey }))
  })
  return { fire, warned: next }
}

const MAX_LIMIT_USD = 1_000_000

/** Projects that still exist, each with its stored limit. Limits left behind by a removed project are skipped. */
export function spendProjects(projects: readonly Pick<Project, 'id' | 'folder'>[], limits: Readonly<Record<string, SpendLimit>>): SpendProject[] {
  return projects.flatMap((project) => (limits[project.id] ? [{ id: project.id, folder: project.folder, limit: limits[project.id] }] : []))
}

export const formatLimitUsd = (usd: number): string => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`)

const PERIOD_WORD: Record<SpendPeriod, string> = { day: 'daily', week: 'weekly' }

export function spendMessage(warning: SpendWarning, projectName: string): string {
  const limit = `${formatLimitUsd(warning.limit.amountUsd)} ${PERIOD_WORD[warning.limit.period]} limit`
  return warning.threshold === 100
    ? `${projectName} has reached its ${limit} (${formatLimitUsd(warning.spentUsd)} used)`
    : `${projectName} has used ${formatLimitUsd(warning.spentUsd)} of its ${limit}`
}

/** A dollar amount typed in the limit dialog, or null when it is not a usable positive amount. */
export function parseLimitAmount(text: string): number | null {
  const match = /^\$?(\d+(?:\.\d{1,2})?)$/.exec(text.trim())
  if (!match) return null
  const value = Number(match[1])
  return value > 0 && value <= MAX_LIMIT_USD ? value : null
}

export function limitReached(projects: readonly SpendProject[], totals: Readonly<Record<string, number>>): string[] {
  return projects.filter((project) => (totals[project.id] ?? 0) >= project.limit.amountUsd).map((project) => project.id)
}
