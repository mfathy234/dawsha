import type { KeptSession, Project } from '../shared/types'
import { removeKeptSession } from './actions'
import { confirmDialog } from './components/dialogs'

/** Asks first, naming the session and its project, then removes it from the closed list (the toast offers an undo). */
export async function confirmRemoveClosed(kept: KeptSession, project: Project | undefined): Promise<boolean> {
  const where = project?.name ?? 'this project'
  const confirmed = await confirmDialog({
    title: `Remove ${kept.title} from ${where}?`,
    body: `This takes ${kept.title} off the closed list. The session stays on disk and can still be found with Resume. You can undo it right after.`,
    confirmLabel: `Remove ${kept.title}`
  })
  if (confirmed) removeKeptSession(kept.agent, kept.sessionId)
  return confirmed
}
