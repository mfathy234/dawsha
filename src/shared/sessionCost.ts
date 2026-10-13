import { AGENTS, AGENT_NAMES } from './agents'
import { dayKey, formatTokens, formatUsd, projectKeyFor, type UsageFile, type UsageHistory } from './usage'
import type { AgentKind, Project } from './types'

export interface UsageTotals {
  tokens: number
  costUsd: number | null
}

export interface ProjectToday extends UsageTotals {
  perAgent: Record<AgentKind, UsageTotals>
}

export interface UsageSnapshot {
  generatedAt: number
  sessions: Record<string, UsageTotals>
  projectsToday: Record<string, ProjectToday>
}

export interface SnapshotInput {
  now: number
  files: UsageFile[]
  projects: Pick<Project, 'id' | 'folder'>[]
  history: UsageHistory
}

export const emptySnapshot = (): UsageSnapshot => ({ generatedAt: 0, sessions: {}, projectsToday: {} })

const emptyTotals = (): UsageTotals => ({ tokens: 0, costUsd: null })

const addCost = (current: number | null, usd: number): number => (current ?? 0) + usd

function emptyProject(): ProjectToday {
  return { tokens: 0, costUsd: null, perAgent: { claude: emptyTotals(), codex: emptyTotals(), gemini: emptyTotals() } }
}

export function buildUsageSnapshot(input: SnapshotInput): UsageSnapshot {
  const today = dayKey(input.now)
  const sessions: Record<string, UsageTotals> = {}
  const projects = new Map<string, ProjectToday>()
  const projectOf = (id: string): ProjectToday => {
    const known = projects.get(id)
    if (known) return known
    const created = emptyProject()
    projects.set(id, created)
    return created
  }
  for (const file of input.files) {
    const projectId = projectKeyFor(file.cwd, input.projects)
    let total = 0
    let todayTokens = 0
    for (const [hour, usage] of Object.entries(file.hours)) {
      total += usage.tokens
      if (hour.startsWith(today)) todayTokens += usage.tokens
    }
    if (file.sessionId && total > 0) {
      const known = sessions[file.sessionId]
      sessions[file.sessionId] = { tokens: (known?.tokens ?? 0) + total, costUsd: null }
    }
    if (projectId && todayTokens > 0) {
      const project = projectOf(projectId)
      project.tokens += todayTokens
      project.perAgent[file.agent].tokens += todayTokens
    }
  }
  for (const [sessionId, cost] of Object.entries(input.history.costs)) {
    const known = sessions[sessionId] ?? emptyTotals()
    sessions[sessionId] = { tokens: known.tokens, costUsd: cost.usd }
    const projectId = dayKey(cost.at) === today ? projectKeyFor(cost.cwd, input.projects) : null
    if (!projectId) continue
    const project = projectOf(projectId)
    project.costUsd = addCost(project.costUsd, cost.usd)
    project.perAgent.claude.costUsd = addCost(project.perAgent.claude.costUsd, cost.usd)
  }
  const projectsToday = Object.fromEntries(
    [...projects.entries()].filter(([, value]) => value.tokens > 0 || (value.costUsd ?? 0) > 0)
  )
  return { generatedAt: input.now, sessions, projectsToday }
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = String(minutes % 60).padStart(2, '0')
  if (hours < 24) return `${hours}h ${rest}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function sessionUsage(usage: UsageTotals | undefined, liveCostUsd: number | null): UsageTotals | null {
  const costUsd = liveCostUsd ?? usage?.costUsd ?? null
  const tokens = usage?.tokens ?? 0
  if (tokens <= 0 && costUsd === null) return null
  return { tokens, costUsd }
}

export function projectTodayLabel(today: ProjectToday | undefined): string | null {
  if (!today) return null
  const parts: string[] = []
  if ((today.costUsd ?? 0) > 0) parts.push(formatUsd(today.costUsd as number))
  if (today.tokens > 0) parts.push(formatTokens(today.tokens))
  return parts.length === 0 ? null : `today ${parts.join(' · ')}`
}

// The single figure shown on a project row: today's cost when known, otherwise its tokens.
export function projectTodayShort(today: ProjectToday | undefined): string | null {
  if (!today) return null
  if ((today.costUsd ?? 0) > 0) return formatUsd(today.costUsd as number)
  return today.tokens > 0 ? formatTokens(today.tokens) : null
}

export function projectTodayTooltip(today: ProjectToday | undefined): string {
  if (!today) return ''
  const lines = AGENTS.flatMap((agent) => {
    const totals = today.perAgent[agent]
    if (totals.tokens <= 0 && (totals.costUsd ?? 0) <= 0) return []
    const parts = [`${formatTokens(totals.tokens)} tokens`]
    if (totals.costUsd !== null) parts.unshift(formatUsd(totals.costUsd))
    return [`${AGENT_NAMES[agent]}: ${parts.join(' · ')}`]
  })
  return ['Today', ...lines].join('\n')
}
