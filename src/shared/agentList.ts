import type { BgFileTouch } from './agentActivity'
import { STATUS_LABELS, spanLabel, totalsOf, type BackgroundAgent, type BgSessionGroup, type BgStatus, type BgTotals } from './backgroundAgents'
import { normalizePath } from './sessionMatch'

export type StateSegmentId = 'all' | BgStatus

export interface StateSegment {
  state: StateSegmentId
  label: string
  count: number
}

const SEGMENT_NAMES: Record<StateSegmentId, string> = { all: 'All', running: 'Running', failed: 'Failed', done: 'Done' }

/** "All 7 · Running 2 · Failed 1 · Done 4" as four buttons' worth of text. */
export function stateSegments(counts: Record<BgStatus, number>): StateSegment[] {
  const all = counts.running + counts.failed + counts.done
  return (['all', 'running', 'failed', 'done'] as const).map((state) => {
    const count = state === 'all' ? all : counts[state]
    return { state, label: `${SEGMENT_NAMES[state]} ${count}`, count }
  })
}

export interface StateCountPart {
  state: BgStatus
  text: string
}

/** Per-state counts for a group header: running and failed first, zeros left out. */
export function stateCountParts(counts: Record<BgStatus, number>): StateCountPart[] {
  return (['running', 'failed', 'done'] as const).filter((state) => counts[state] > 0).map((state) => ({ state, text: `${counts[state]} ${STATUS_LABELS[state]}` }))
}

const firstLine = (text: string): string => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''

/** The second line of a row: what it is doing now, or how it ended. */
export function summaryLine(agent: BackgroundAgent): string {
  const latest = agent.tools[0] ? `${agent.tools[0].name} ${agent.tools[0].brief}`.trim() : ''
  if (agent.status === 'running') return latest || agent.lastStep
  if (agent.status === 'failed') return agent.statusNote || firstLine(agent.result) || latest || agent.lastStep
  return firstLine(agent.result) || agent.lastStep
}

/** Tokens and cost of agents active since local midnight. */
export function todayTotals(agents: readonly BackgroundAgent[], now: number): BgTotals {
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  return totalsOf(agents.filter((agent) => agent.lastActivityAt >= midnight))
}

export interface FileTarget {
  projectId: string
  folder: string
  path: string
}

const isAbsolute = (path: string): boolean => /^([a-zA-Z]:[\\/]|[\\/])/.test(path)

/** Where Files should open a touched file: in the agent's own checkout when it is inside it, else the project folder. */
export function fileTarget(agent: Pick<BackgroundAgent, 'projectId' | 'cwd'>, path: string, projects: readonly { id: string; folder: string }[]): FileTarget | null {
  const project = agent.projectId ? projects.find((entry) => entry.id === agent.projectId) : undefined
  if (!project) return null
  const roots = [agent.cwd, project.folder].filter((root): root is string => root !== null && root !== '')
  const slashed = path.replace(/\\/g, '/')
  if (!isAbsolute(path)) return { projectId: project.id, folder: roots[0], path: slashed.replace(/^\.\//, '') }
  const lowered = normalizePath(path)
  for (const root of roots) {
    const prefix = `${normalizePath(root)}/`
    if (lowered.startsWith(prefix)) return { projectId: project.id, folder: root, path: slashed.slice(prefix.length) }
  }
  return null
}

export const retryPrompt = (agent: Pick<BackgroundAgent, 'description' | 'statusNote' | 'result'>): string => {
  const why = agent.statusNote || firstLine(agent.result)
  return `The background agent "${agent.description}" failed${why ? ` (${why})` : ''}. Please look at why and retry it.`
}

const deltas = (file: BgFileTouch): string => (file.added === null && file.removed === null ? '' : ` (+${file.added ?? 0} −${file.removed ?? 0})`)

/** The agents on screen as Markdown: a heading per session, a line per agent with its summary and files. */
export function agentsMarkdown(groups: readonly BgSessionGroup[], now: number): string {
  if (groups.length === 0) return '# Agents\n\nNo agents match the current filters.\n'
  const out = ['# Agents', '']
  for (const group of groups) {
    out.push(`## ${group.title}`, `${group.project} · ${group.agents.length} agent${group.agents.length === 1 ? '' : 's'}`, '')
    for (const agent of group.agents) {
      const end = agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt
      out.push(`- **${agent.description}** · ${STATUS_LABELS[agent.status]} · ${spanLabel(end - agent.startedAt)}`)
      const summary = summaryLine(agent)
      if (summary) out.push(`  - ${summary}`)
      if (agent.files.length > 0) out.push(`  - Files: ${agent.files.map((file) => `${file.change} ${file.path}${deltas(file)}`).join(', ')}`)
    }
    out.push('')
  }
  return `${out.join('\n')}`
}
