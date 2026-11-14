import { COMPACT_SLASH } from '../shared/chatContext'
import { getTerminal } from './terminals'

export function typeCompact(tabId: string): void {
  const view = getTerminal(tabId)
  if (!view) return
  view.focus()
  view.insertText(COMPACT_SLASH)
}
