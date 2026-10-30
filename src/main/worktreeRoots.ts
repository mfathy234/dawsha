import { groupWorktreeProjects, type GroupableProject, type ProjectGroup } from '../shared/worktreeGroups'
import { git } from './gitCommit'

const TTL = 30_000
const mainCache = new Map<string, { at: number; job: Promise<string | null> }>()

/** The main checkout of the repository a folder belongs to, or null when the folder is not a git checkout. */
export function mainCheckoutOf(folder: string): Promise<string | null> {
  const cached = mainCache.get(folder)
  if (cached && Date.now() - cached.at < TTL) return cached.job
  const job = git(folder, ['worktree', 'list', '--porcelain', '-z']).then((out) => {
    if (!out.ok) return null
    const first = out.stdout.split('\0').find((field) => field.startsWith('worktree '))
    return first ? first.slice('worktree '.length) : null
  })
  mainCache.set(folder, { at: Date.now(), job })
  return job
}

/** Which project each configured project counts under, for the Work dashboard and the Projects page. */
export async function projectWorktreeGroups(projects: readonly GroupableProject[], mainOf: (folder: string) => Promise<string | null> = mainCheckoutOf): Promise<Map<string, ProjectGroup>> {
  const mains = new Map(await Promise.all(projects.map(async (project) => [project.folder, await mainOf(project.folder)] as const)))
  return groupWorktreeProjects(projects, (folder) => mains.get(folder) ?? null)
}
