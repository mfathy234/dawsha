import { agentLabel } from './agents'
import type { PermissionDetail } from './permissionPrompt'
import type { TabAgent } from './types'

/** Longest line a notification body gets before it is cut with an ellipsis. */
const MAX_LINE = 140

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const clip = (text: string): string => (text.length <= MAX_LINE ? text : `${text.slice(0, MAX_LINE - 1).trimEnd()}…`)

const VERBS: Readonly<Record<string, string>> = { Bash: 'run', Edit: 'edit', MultiEdit: 'edit', Write: 'write', Read: 'read' }

/** One line that says what a waiting agent is asking for, from the parsed permission prompt. */
export function askingLine(detail: PermissionDetail | null): string {
  const target = oneLine(detail?.target ?? '')
  if (!detail || target === '') return 'Waiting for your approval'
  const verb = VERBS[detail.tool]
  return clip(verb ? `Wants to ${verb} ${target}` : `Wants to use ${detail.tool}: ${target}`)
}

const MARKDOWN = /(\*\*|__|`|^#+\s*|^[-*+]\s+|^\d+\.\s+|^>\s*)/gm

/** The end of a reply, as plain text, for a "done" notification. Null when the reply is empty. */
export function replySnippet(reply: string): string | null {
  const lines = reply.split('\n').map((line) => line.replace(MARKDOWN, '').trim()).filter((line) => line !== '')
  if (lines.length === 0) return null
  const tail = lines.slice(-2).join(' ')
  const text = oneLine(tail)
  return text.length <= MAX_LINE ? text : `…${text.slice(text.length - MAX_LINE + 1).trimStart()}`
}

/** The small grey line under a Windows toast: which project and which agent. */
export function notifyAttribution(projectName: string | undefined, agent: TabAgent): string {
  return [projectName, agentLabel(agent)].filter(Boolean).join(' · ')
}

export interface ToastContent {
  title: string
  body: string
  attribution?: string
  silent: boolean
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** A Windows toast: a one-line title, up to two lines of body, and the project and agent in small type. */
export function toastXml(content: ToastContent): string {
  const attribution = content.attribution ? `<text placement="attribution">${escapeXml(content.attribution)}</text>` : ''
  return [
    '<toast activationType="foreground" launch="dawsha">',
    '<visual><binding template="ToastGeneric">',
    `<text hint-maxLines="1">${escapeXml(content.title)}</text>`,
    `<text>${escapeXml(content.body)}</text>`,
    attribution,
    '</binding></visual>',
    content.silent ? '<audio silent="true"/>' : '<audio src="ms-winsoundevent:Notification.Default"/>',
    '</toast>'
  ].join('')
}
