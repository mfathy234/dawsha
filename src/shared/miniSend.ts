import { detectPermissionPrompt } from './permissionPrompt'
import { detectTerminalMenu } from './terminalMenu'
import type { TabAgent } from './types'

export interface MiniSendCheck {
  agent: TabAgent
  status: string
  tail: string
}

/** Why a reply from the Mini window must not be typed into the session right now, or null when it is safe. */
export function miniSendRefusal(check: MiniSendCheck): string | null {
  if (check.agent === 'shell') return 'Mini replies only go to agent sessions.'
  if (check.status === 'exited') return 'That session has exited.'
  if (detectPermissionPrompt(check.tail)) return 'That session is waiting for your answer. Open it to reply.'
  if (detectTerminalMenu(check.tail)) return 'That session is showing a menu. Open it to reply.'
  return null
}
