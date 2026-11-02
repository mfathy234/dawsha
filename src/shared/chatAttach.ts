import { DROP_FILE_LIMIT, dropPasteText, shellKindOf } from './clipboard'
import type { TabAgent } from './types'
import { baseName, mimeFromName } from './chatImage'

export interface Attachment {
  path: string
  name: string
  image: boolean
}

export function attachmentOf(path: string): Attachment {
  return { path, name: baseName(path), image: mimeFromName(path) !== null }
}

/** The attachments plus the new paths, without repeats, never more than the drop limit. */
export function addAttachments(list: readonly Attachment[], paths: readonly string[]): Attachment[] {
  const have = new Set(list.map((item) => item.path))
  const fresh = paths.filter((path) => path !== '' && !have.has(path)).filter((path, index, all) => all.indexOf(path) === index)
  return [...list, ...fresh.map(attachmentOf)].slice(0, DROP_FILE_LIMIT)
}

export const removeAttachment = (list: readonly Attachment[], path: string): Attachment[] => list.filter((item) => item.path !== path)

/** What is typed into the terminal: the paths first, as a drop would write them, then the message. */
export function messageWithAttachments(agent: TabAgent | undefined, list: readonly Attachment[], text: string, shellCommand = ''): string {
  const paths = dropPasteText(agent, list.map((item) => item.path), shellKindOf(shellCommand))
  return `${paths}${text}`.trim()
}

export interface ChatPreviewRequest {
  agent: TabAgent
  sessionId: string
  /** A path from a paste or a drop; main checks it lies in the project or the paste folder before reading it. */
  path: string
}
