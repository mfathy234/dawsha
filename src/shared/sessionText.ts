import { cleanText } from './transcript'

export const PREVIEW_PROMPT_MAX = 420
export const PREVIEW_REPLY_MAX = 520
// Only the start of a message matters for a preview, so long pastes are never cleaned whole.
const RAW_MAX = 6000

// Blocks the harness injects around or instead of what the person typed.
const DROP_BLOCK = /<(system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|bash-input|bash-stdout|bash-stderr|task-notification|user-prompt-submit-hook|environment_context|ide_opened_file|ide_selection|ide_diagnostics|command-message|user_instructions|INSTRUCTIONS)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi
const COMMAND = /<command-name>\s*([^<]*?)\s*<\/command-name>(?:\s*<command-message>[\s\S]*?<\/command-message>)?(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/gi
const PASTED = /<\/?pasted_content\b[^>]*>/gi
const IMAGE = /\[Image(?: #\d+|: [^\]]*)\]/gi
const NOT_A_REQUEST = [
  /^\[Request interrupted/i,
  /^Caveat:/i,
  /^This session is being continued from a previous conversation/i,
  /^Base directory for this skill:/i,
  /^# AGENTS\.md instructions for /i,
  /^<(?:turn_aborted|permissions instructions)/i
]
const AUTOMATED: [RegExp, string][] = [
  [/^Below is a conversation log from a Claude Code coding session\./i, 'Automatic summary of an earlier session'],
  [/^The following is the Codex agent history whose request action you are assessing/i, 'Automatic safety review of a command']
]

const AUTOMATED_LABELS = new Set(AUTOMATED.map(([, label]) => label))

/** Sessions another tool started (summaries, safety reviews); the resume list hides them unless asked. */
export const isAutomaticSession = (firstPrompt: string | undefined): boolean => firstPrompt !== undefined && AUTOMATED_LABELS.has(firstPrompt)

const FENCE = /```[^\n]*\n[\s\S]*?(?:```|$)/g
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function markdownLine(line: string): string {
  const bullet = /^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/.exec(line)
  const body = (bullet ? bullet[1] : line)
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*\||\|\s*$/g, '')
    .replace(/\s*\|\s*/g, ' · ')
    .trim()
  return bullet && body ? `• ${body}` : body
}

/** One readable paragraph: harness markup, ANSI and markdown syntax gone, whitespace collapsed. */
export function flattenText(raw: string): string {
  let text = cleanText(raw.slice(0, RAW_MAX))
    .replace(DROP_BLOCK, ' ')
    .replace(COMMAND, (_all, name: string, args?: string) => (args?.trim() ? `${name} ${args.trim()}` : ' '))
    .replace(PASTED, ' ')
    .replace(IMAGE, ' ')
    .replace(FENCE, ' [code] ')
  text = text
    .split('\n')
    .filter((line) => !TABLE_RULE.test(line))
    .map(markdownLine)
    .filter(Boolean)
    .join(' ')
  return text.replace(/\s+/g, ' ').replace(/(\[code\]\s*)+/g, '[code] ').trim()
}

/** Cuts at a word boundary and says so; never splits a surrogate pair. */
export function clipWords(text: string, limit: number): string {
  if (text.length <= limit) return text
  let end = limit
  const space = text.lastIndexOf(' ', limit)
  if (space >= limit * 0.6) end = space
  else if (/[\ud800-\udbff]/.test(text[end - 1] ?? '')) end -= 1
  return `${text.slice(0, end).replace(/[\s,;:(\-–—]+$/, '')}…`
}

/** The first thing the person actually asked, or null for messages that only look like prompts. */
export function realPrompt(raw: string, limit: number = PREVIEW_PROMPT_MAX): string | null {
  const head = raw.trimStart().slice(0, 400)
  if (NOT_A_REQUEST.some((pattern) => pattern.test(head))) return null
  const automated = AUTOMATED.find(([pattern]) => pattern.test(head))
  if (automated) return automated[1]
  const text = flattenText(raw)
  if (text === '' || text.startsWith('<') || NOT_A_REQUEST.some((pattern) => pattern.test(text))) return null
  return clipWords(text, limit)
}

/** A reply with words in it; empty turns and bare tool-call turns come back null. */
export function realReply(raw: string, limit: number = PREVIEW_REPLY_MAX): string | null {
  const text = flattenText(raw)
  return /[\p{L}\p{N}]/u.test(text.replaceAll('[code]', '')) ?clipWords(text, limit) : null
}
