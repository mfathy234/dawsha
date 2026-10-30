import type { GroupableProject, ProjectGroup } from './worktreeGroups'

export interface ProjectBranch<T> {
  project: T
  /** Worktrees counted under the project, in the order they were configured. */
  worktrees: T[]
}

/**
 * The Projects page rows: each project that counts on its own, with the worktrees under it. A project whose group
 * points at a project that is not in the list stays a row of its own, so no project can vanish from the page.
 */
export function projectBranches<T extends GroupableProject>(projects: readonly T[], groups: Readonly<Record<string, ProjectGroup>>): ProjectBranch<T>[] {
  const ids = new Set(projects.map((project) => project.id))
  const rootOf = (project: T): string | null => {
    const group = groups[project.id]
    return group && group.rootId !== project.id && ids.has(group.rootId) ? group.rootId : null
  }
  return projects
    .filter((project) => rootOf(project) === null)
    .map((project) => ({ project, worktrees: projects.filter((candidate) => rootOf(candidate) === project.id) }))
}
