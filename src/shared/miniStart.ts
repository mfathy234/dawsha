import type { AgentKind, Project } from './types'

export const MINI_START_MAX = 4000

export interface MiniStartProject {
  id: string
  name: string
  agent: AgentKind
}

/** What the Mini window's form may offer: projects with the recent ones first, and the agents that are installed. */
export interface MiniStartOptions {
  projects: MiniStartProject[]
  agents: AgentKind[]
}

export interface MiniStartRequest {
  projectId: string
  agent: AgentKind
  text: string
}

const AGENTS: readonly AgentKind[] = ['claude', 'codex', 'gemini']

export const isAgentKind = (value: unknown): value is AgentKind => typeof value === 'string' && (AGENTS as readonly string[]).includes(value)

/** Recent projects first, in the order they were used, then the rest as the sidebar has them. */
export function orderMiniProjects(projects: readonly Pick<Project, 'id' | 'name' | 'defaultAgent'>[], recentIds: readonly string[]): MiniStartProject[] {
  const byId = new Map(projects.map(project => [project.id, project]))
  const recent = recentIds.map(id => byId.get(id)).filter((project): project is NonNullable<typeof project> => !!project)
  const seen = new Set(recent.map(project => project.id))
  return [...recent, ...projects.filter(project => !seen.has(project.id))]
    .map(project => ({ id: project.id, name: project.name, agent: project.defaultAgent }))
}

/** Agents the form offers: those a checked install report found, or all three while nothing was checked yet. */
export function startAgents(report: readonly { agent: AgentKind; present: boolean }[] | null): AgentKind[] {
  if (!report) return [...AGENTS]
  return AGENTS.filter(agent => report.find(tool => tool.agent === agent)?.present === true)
}

/** Why a session must not be started from the Mini window right now, or null when it is fine. */
export function miniStartRefusal(request: MiniStartRequest, options: MiniStartOptions): string | null {
  if (!options.projects.some(project => project.id === request.projectId)) return 'That project is gone.'
  if (!options.agents.includes(request.agent)) return 'That agent is not installed.'
  if (request.text.length > MINI_START_MAX) return 'That first message is too long.'
  return null
}
