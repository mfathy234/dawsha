import { api } from './api'
import { toast } from './components/toast'

export const COPY_SESSION_NAME = 'Copy session name'

/** Puts a session's name on the clipboard, and says so. */
export async function copySessionName(name: string): Promise<void> {
  const text = name.trim()
  if (text === '') {
    toast('This session has no name yet.', 'info')
    return
  }
  try {
    await api.writeClipboard(text)
    toast(`Copied “${text}”`, 'info')
  } catch {
    toast('Could not copy the session name.', 'error')
  }
}
