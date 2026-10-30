import { normalizeFolder } from './folderKey'

export interface GroupableProject {
  id: string
  name: string
  folder: string
}

/** Where a project counts: its own id, or the project whose checkout it is a git worktree of, with the worktree's folder name. */
export interface ProjectGroup {
  rootId: string
  worktree: string | null
}

const folderName = (folder: string): string => normalizeFolder(folder).split('/').pop() || folder

/**
 * Groups every project that is a git worktree of another project under that project, so a worktree's sessions
 * count as the project's own work. `mainCheckoutOf` gives the main checkout of a folder's repository (null when
 * the folder is not a checkout). A project whose main checkout is not a known project stays on its own.
 */
export function groupWorktreeProjects(projects: readonly GroupableProject[], mainCheckoutOf: (folder: string) => string | null): Map<string, ProjectGroup> {
  const byFolder = new Map(projects.map((project) => [normalizeFolder(project.folder), project]))
  const groups = new Map<string, ProjectGroup>()
  for (const project of projects) {
    const main = mainCheckoutOf(project.folder)
    const root = main ? byFolder.get(normalizeFolder(main)) : undefined
    groups.set(project.id, root && root.id !== project.id
      ? { rootId: root.id, worktree: folderName(project.folder) }
      : { rootId: project.id, worktree: null })
  }
  return groups
}
