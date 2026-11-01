import type { AgentEditEvent } from '../../shared/codeNavExtras'
import { normalizeFolder } from '../../shared/folderKey'

/** The repo path to open for an edit the agent just made (the event already carries a repo path), or null when following is off or the edit is in another folder. */
export function followTarget(event: AgentEditEvent, folder: string | null, enabled: boolean): string | null {
  if (!enabled || !folder || normalizeFolder(event.folder) !== normalizeFolder(folder)) return null
  return event.path === '' ? null : event.path
}

/** Whether the view may switch files without throwing away what the user is doing. */
export const mayFollow = (active: { dirty: boolean; editing: boolean } | null): boolean => !active || (!active.dirty && !active.editing)
