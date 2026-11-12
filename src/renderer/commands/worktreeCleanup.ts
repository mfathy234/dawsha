import { toast } from '../components/toast'
import { paneById, store } from '../state'
import { openWorktreeCleanup } from '../worktreeCleanupActions'
import { registerCommands } from './registry'

/** The project of the focused session, else the only project there is. */
function targetProject(): string | null {
  const focused = paneById(store.state, store.state.focusedId)?.projectId
  if (focused) return focused
  const projects = store.state.settings.projects
  return projects.length === 1 ? projects[0].id : null
}

export function installWorktreeCleanupCommands(): void {
  registerCommands({
    id: 'project.cleanup-worktrees',
    title: 'Clean up worktrees…',
    group: 'Actions',
    keywords: 'worktree remove delete leftover closed sessions branches disk space',
    run: () => {
      const projectId = targetProject()
      if (projectId) void openWorktreeCleanup(projectId)
      else toast('Focus a session in the project first.', 'info')
    }
  })
}
