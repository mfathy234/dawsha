import { realpath, stat } from 'node:fs/promises'
import type { FilesCheckout, FilesWorkspacesResult } from '../shared/filesWorkspace'
import { git } from './gitCommit'
import { knownProjectFolder } from './knownFolder'

export function parseWorktrees(output: string): FilesCheckout[] {
  return output.split('\0\0').filter(Boolean).flatMap((record, index) => {
    const fields = record.split('\0')
    const folder = fields.find(field => field.startsWith('worktree '))?.slice(9)
    if (!folder) return []
    return [{ folder, branch: fields.find(field => field.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') ?? '', head: fields.find(field => field.startsWith('HEAD '))?.slice(5) ?? '', detached: fields.includes('detached'), unavailable: fields.some(field => field === 'prunable' || field.startsWith('prunable ')), main: index === 0 }]
  })
}

export async function listFilesWorkspaces(projects: ReadonlyArray<{ id: string; folder: string }>, projectId: unknown, selectedFolder?: unknown): Promise<FilesWorkspacesResult> {
  const project = projects.find(project => project.id === projectId)
  if (!project) return { ok: false, error: 'Not a configured project.' }
  try {
    const folder = await realpath(project.folder)
    const allowed = await knownProjectFolder([project], selectedFolder ?? folder)
    if (!allowed) return { ok: false, error: 'Not a checkout of this project.' }
    const selected = await realpath(allowed)
    if (!(await stat(folder)).isDirectory()) throw new Error('Project folder is unavailable.')
    const result = await git(folder, ['worktree', 'list', '--porcelain', '-z'])
    if (!result.ok) return { ok: true, git: false, folder: selected, checkouts: [{ folder, branch: '', head: '', detached: false, unavailable: false, main: true }] }
    const checkouts = await Promise.all(parseWorktrees(result.stdout).map(async checkout => {
      try {
        return { ...checkout, folder: await realpath(checkout.folder), unavailable: checkout.unavailable || !(await stat(checkout.folder)).isDirectory() }
      } catch { return { ...checkout, unavailable: true } }
    }))
    // A configured subfolder remains the default scope; selecting another entry explicitly uses its root.
    if (!checkouts.some(checkout => checkout.folder.toLowerCase() === folder.toLowerCase())) {
      const branch = await git(folder, ['symbolic-ref', '--short', 'HEAD'])
      checkouts.unshift({ folder, branch: branch.ok ? branch.stdout.trim() : '', head: '', detached: !branch.ok, unavailable: false, main: false })
    }
    return { ok: true, git: true, folder: selected, checkouts }
  } catch { return { ok: false, error: 'Project folder is unavailable.' } }
}
