import type { Project } from './types'

export type DesktopAction = { kind: 'new-session'; projectId: string | null } | { kind: 'mini-window' }

export function parseDesktopAction(argv: readonly string[]): DesktopAction | null {
  for (const arg of argv) {
    if (arg === '--mini-window') return { kind: 'mini-window' }
    if (arg === '--new-session') return { kind: 'new-session', projectId: null }
    if (!arg.startsWith('--new-session=')) continue
    try {
      const projectId = decodeURIComponent(arg.slice('--new-session='.length))
      return projectId && !/[\u0000-\u001f]/.test(projectId) ? { kind: 'new-session', projectId } : null
    } catch { return null }
  }
  return null
}

export function recentProjects(projects: readonly Project[], ids: readonly string[]): Project[] {
  const ordered = [...new Set([...ids, ...projects.map(project => project.id)])]
  return ordered.flatMap(id => {
    const project = projects.find(item => item.id === id)
    return project ? [project] : []
  }).slice(0, 5)
}

interface JumpTask { type: 'task'; title: string; description?: string; program: string; args: string; iconPath: string; iconIndex: number }
interface JumpCategory { type: 'custom' | 'tasks'; name?: string; items: JumpTask[] }

/**
 * The Windows taskbar right-click menu. Entries carry Dawsha's own .ico, never the running program's icon
 * (electron.exe when run from source), and the project entries are just names under one heading because
 * Windows cuts long entry titles short.
 */
export function buildJumpList(projects: readonly Project[], recentIds: readonly string[], executable: string, icon: string, removedArgs: readonly string[] = [], prefix = ''): JumpCategory[] {
  const task = (title: string, args: string, description?: string): JumpTask =>
    ({ type: 'task', title, ...(description ? { description } : {}), program: executable, args: prefix + args, iconPath: icon, iconIndex: 0 })
  return [
    { type: 'custom', name: 'New Claude session', items: recentProjects(projects, recentIds)
      .map(project => task(project.name, `--new-session=${encodeURIComponent(project.id)}`, `New Claude session in ${project.name}`))
      .filter(item => !removedArgs.includes(item.args)) },
    { type: 'tasks', items: [task('New session', '--new-session'), task('Mini window', '--mini-window')] }
  ]
}
