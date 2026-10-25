import { filterProjects } from './quickPick'
import { closedSessionsFor } from './keptSessions'
import type { KeptSession, Project } from './types'

export interface SidebarEntry<V> {
  project: Project
  views: V[]
  closed: KeptSession[]
}

interface TitledView {
  title: string
  pane: { projectId: string }
}

const hasText = (title: string, needle: string): boolean => title.toLowerCase().includes(needle)

// A project that matches by name keeps all its sessions; one that only matches through a session lists just those sessions.
export function filterSidebar<V extends TitledView>(
  projects: Project[],
  views: readonly V[],
  kept: readonly KeptSession[],
  openKeys: ReadonlySet<string>,
  query: string
): SidebarEntry<V>[] {
  const needle = query.trim().toLowerCase()
  const entry = (project: Project): SidebarEntry<V> => ({
    project,
    views: views.filter((view) => view.pane.projectId === project.id),
    closed: closedSessionsFor(kept, project.id, openKeys)
  })
  if (!needle) return projects.map(entry)
  const byName = filterProjects(projects, needle)
  const named = new Set(byName.map((project) => project.id))
  const bySession = projects.flatMap((project) => {
    if (named.has(project.id)) return []
    const full = entry(project)
    const narrowed = {
      project,
      views: full.views.filter((view) => hasText(view.title, needle)),
      closed: full.closed.filter((session) => hasText(session.title, needle))
    }
    return narrowed.views.length + narrowed.closed.length > 0 ? [narrowed] : []
  })
  return [...byName.map(entry), ...bySession]
}
