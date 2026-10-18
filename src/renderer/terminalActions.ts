import { toast } from './components/toast'
import { paneById, store } from './state'
import { getTerminal } from './terminals'
import type { TerminalView } from './terminalView'

export function paneTerminal(paneId: string | null | undefined): TerminalView | undefined {
  const pane = paneById(store.state, paneId ?? null)
  return pane ? getTerminal(pane.activeTabId) : undefined
}

export const focusedTerminal = (): TerminalView | undefined => paneTerminal(store.state.focusedId)

export const canJumpPrompt = (direction: 1 | -1): boolean => focusedTerminal()?.prompts.canJump(direction) ?? false

export function jumpPrompt(direction: 1 | -1): void {
  focusedTerminal()?.prompts.jump(direction)
}


const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

export async function copyLastReply(paneId: string): Promise<void> {
  const view = paneTerminal(paneId)
  if (!view) return
  const reply = view.prompts.replyText()
  if (reply.text === '') {
    toast('Nothing to copy yet.', 'info')
    return
  }
  await view.writeClipboard(reply.text)
  const note = reply.fromScreen ? ' of the visible screen (no prompt sent yet)' : ''
  toast(`Copied ${plural(reply.lineCount, 'line')}${note}`, 'info')
}

export async function copyCurrentPrompt(paneId: string): Promise<void> {
  const view = paneTerminal(paneId)
  if (!view) return
  const text = view.prompts.promptText()
  if (text === '') {
    toast('Nothing typed yet', 'info')
    return
  }
  await view.writeClipboard(text)
  toast(`Copied the prompt (${plural(Array.from(text).length, 'character')})`, 'info')
}

export function clearScrollback(paneId: string): void {
  const view = paneTerminal(paneId)
  if (!view) return
  view.clearScrollback()
  toast('Scrollback cleared', 'info')
}
