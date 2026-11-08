import { CHAT_TARGET_MAX, CHAT_OUTPUT_MAX } from './chatLog'
import { flat } from './transcript'

export interface ShellLabelInput {
  command: string
  /** What Claude Code says the command is for; Codex has none. */
  description?: string
  /** The session folder; a leading `cd` into it is noise. */
  folder?: string
}

export interface ShellLabel {
  /** The one line a row shows. */
  text: string
  /** The raw command, only when the row text is not already it. */
  command?: string
  /** True when the text is a plain-language description, not a command. */
  described?: boolean
}

const LEADING_CD = /^\s*cd\s+("[^"]*"|'[^']*'|[^\s;&]+)\s*(?:&&|;)\s*/

/** A path as one comparable form: forward slashes, git-bash /c/ as c:/, no trailing slash, lower case. */
function normalizePath(path: string): string {
  const slashed = path.trim().replace(/^["']|["']$/g, '').replace(/[\\]/g, '/').replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:')
  return slashed.replace(/\/+$/, '').toLowerCase()
}

function insideFolder(path: string, folder: string): boolean {
  const target = normalizePath(path)
  const root = normalizePath(folder)
  return root !== '' && (target === root || target.startsWith(`${root}/`))
}

/** The command without a leading `cd` into the session folder or below it. */
export function stripFolderCd(command: string, folder?: string): string {
  const match = folder ? LEADING_CD.exec(command) : null
  if (!match || !folder || !insideFolder(match[1], folder)) return command
  const rest = command.slice(match[0].length)
  return rest.trim() === '' ? command : rest
}

/** What a shell row says: the description when there is one, else the command with its folder `cd` removed, on one line. */
export function shellLabel(input: ShellLabelInput): ShellLabel {
  const described = input.description?.trim() ?? ''
  const text = flat(described !== '' ? described : stripFolderCd(input.command, input.folder), CHAT_TARGET_MAX)
  const raw = input.command.trim()
  const base = text === raw ? { text } : { text, command: raw.slice(0, CHAT_OUTPUT_MAX) }
  return described !== '' ? { ...base, described: true } : base
}
