import type { SessionBaseline } from './gitStatus'
import type { SessionTag } from './sessionTags'
import type { CrewIdentity } from './crew'
import { sanitizeSplits } from './splits'
import { LAYOUT_NAME_MAX, MAX_LAYOUTS } from './settingsSchema'
import type { AgentKind, CompareLink, GridSplits, Project, SavedLayout, SavedPane, TabAgent, Workspace } from './types'

export interface SnapshotTab {
  id: string
  agent: TabAgent
  label: string
  titleHint?: string
  sessionId?: string
  from?: AgentKind
  baseline?: SessionBaseline
  task?: unknown
  name?: string
  tag?: SessionTag
  crew?: CrewIdentity
}

export interface SnapshotPane {
  id: string
  projectId: string
  folder?: string
  compare?: CompareLink
  fontSize: number
  activeTabId: string
  pinned?: boolean
  tabs: SnapshotTab[]
}

export interface SnapshotOptions {
  sessionFor?: (tab: SnapshotTab) => string | undefined
  portable?: boolean
  splits?: GridSplits
}

export function snapshotWorkspace(
  panes: SnapshotPane[],
  focusedId: string | null,
  options: SnapshotOptions = {}
): Workspace {
  const sessionFor = options.sessionFor ?? ((tab: SnapshotTab) => tab.sessionId)
  const kept = panes
    .map((pane) => ({ ...pane, tabs: pane.tabs.filter((tab) => tab.task === undefined) }))
    .filter((pane) => pane.tabs.length > 0)
  const focusedIndex = Math.max(0, kept.findIndex((pane) => pane.id === focusedId))
  const workspace: Workspace = {
    focusedIndex,
    panes: kept.map((pane): SavedPane => {
      const detached = options.portable === true && (pane.compare !== undefined || pane.folder !== undefined)
      const saved: SavedPane = {
        projectId: pane.projectId,
        fontSize: pane.fontSize,
        activeIndex: Math.max(0, pane.tabs.findIndex((tab) => tab.id === pane.activeTabId)),
        tabs: pane.tabs.map((tab) => ({
          agent: tab.agent,
          label: tab.label,
          titleHint: tab.titleHint,
          sessionId: tab.agent === 'shell' || detached ? undefined : sessionFor(tab),
          from: tab.from,
          baseline: options.portable === true ? undefined : tab.baseline,
          name: tab.name,
          tag: tab.tag,
          crew: tab.crew
        }))
      }
      if (options.portable !== true) {
        if (pane.folder) saved.folder = pane.folder
        if (pane.compare) saved.compare = pane.compare
      }
      if (pane.pinned === true) saved.pinned = true
      return saved
    })
  }
  const splits = sanitizeSplits(options.splits)
  if (splits) workspace.splits = splits
  return workspace
}

export const layoutSlug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export function findLayout(layouts: SavedLayout[], query: string): SavedLayout | undefined {
  const wanted = query.trim()
  if (!wanted) return undefined
  const lower = wanted.toLowerCase()
  return (
    layouts.find((layout) => layout.id === wanted) ??
    layouts.find((layout) => layout.name.toLowerCase() === lower) ??
    layouts.find((layout) => layoutSlug(layout.name) === layoutSlug(wanted) && layoutSlug(wanted) !== '')
  )
}

export function validateLayoutName(name: string, layouts: SavedLayout[], exceptId?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a name.'
  if (trimmed.length > LAYOUT_NAME_MAX) return `Use at most ${LAYOUT_NAME_MAX} characters.`
  const taken = layouts.find((layout) => layout.id !== exceptId && layout.name.toLowerCase() === trimmed.toLowerCase())
  if (taken) return `A layout named '${taken.name}' already exists.`
  if (exceptId === undefined && layouts.length >= MAX_LAYOUTS) return `You can keep at most ${MAX_LAYOUTS} layouts.`
  return null
}

export interface OpenPlan {
  openable: SavedPane[]
  missingProjects: string[]
  focusedIndex: number
}

export function planOpen(layout: SavedLayout, projects: Pick<Project, 'id'>[]): OpenPlan {
  const known = new Set(projects.map((project) => project.id))
  const openable = layout.panes.filter((pane) => known.has(pane.projectId))
  const missingProjects = [...new Set(layout.panes.filter((pane) => !known.has(pane.projectId)).map((pane) => pane.projectId))]
  const focusedPane = layout.panes[layout.focusedIndex]
  const focusedIndex = Math.max(0, openable.findIndex((pane) => pane === focusedPane))
  return { openable, missingProjects, focusedIndex }
}

export const paneCountText = (count: number): string => `${count} pane${count === 1 ? '' : 's'}`

export function openedText(layout: SavedLayout, plan: OpenPlan): string {
  const total = layout.panes.length
  const opened = plan.openable.length
  if (opened === total) return `Opened layout '${layout.name}' (${paneCountText(total)})`
  const skipped = total - opened
  return `Opened layout '${layout.name}' (${opened} of ${total} panes; ${skipped} skipped because a project was removed)`
}

export function layoutProjectNames(layout: SavedLayout, projects: Pick<Project, 'id' | 'name'>[]): string[] {
  const names = layout.panes.map((pane) => projects.find((project) => project.id === pane.projectId)?.name ?? 'removed project')
  return [...new Set(names)]
}

export function paneAgent(pane: SavedPane): TabAgent {
  return (pane.tabs.find((tab) => tab.agent !== 'shell') ?? pane.tabs[0]).agent
}
