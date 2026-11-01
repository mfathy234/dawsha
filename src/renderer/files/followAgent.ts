import type { AgentEditEvent } from '../../shared/codeNavExtras'
import { normalizeFolder } from '../../shared/folderKey'
import { toRepoPath } from '../../shared/projectPaths'

/** The repo path to open for an edit the agent just made, or null when following is off or the edit is in another folder. */
export function followTarget(event: AgentEditEvent, folder: string | null, prefix: string, enabled: boolean): string | null {
  if (!enabled || !folder || normalizeFolder(event.folder) !== normalizeFolder(folder)) return null
  return event.path === '' ? null : toRepoPath(prefix, event.path)
}

/** Whether the view may switch files without throwing away what the user is doing. */
export const mayFollow = (active: { dirty: boolean; editing: boolean } | null): boolean => !active || (!active.dirty && !active.editing)
