const RECAP_LINE = /^[\s*●•✻✶✽※⏺-]*(?:※\s*)?recap:\s*(.+)$/i
const REPLY_LINE = /^\s*[●•✦⏺]\s+(.+)$/
const TOOL_CALL = /^[A-Za-z][\w.-]*\(.*\)?\s*$/
/** The agent's input line: Claude's ❯, Codex's ›, or a plain >. */
const INPUT_LINE = /^\s*[❯›>](\s|$)/
/** Notices the agent prints with a bullet that are not part of its reply. */
const NOTICE = /^Remote Control\b/i
const MAX_RECAP = 240

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g

export function cleanRecap(text: string): string {
  const plain = text
    .replace(CONTROL, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > MAX_RECAP ? `${plain.slice(0, MAX_RECAP - 1)}…` : plain
}

/**
 * One line that says where a session is: Claude Code's own "recap:" line when the screen has one,
 * else the first line of its last reply. Tool calls like "● Bash(...)" are not replies.
 */
export function recapFromScreen(screen: string): string {
  const lines = screen.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = RECAP_LINE.exec(lines[index])
    if (match) return cleanRecap(match[1])
  }
  // Below the input box is the agent's status line ("● main ✻ claude Opus 5.5"), never a reply.
  const prompt = lines.findLastIndex((line) => INPUT_LINE.test(line))
  for (let index = (prompt >= 0 ? prompt : lines.length) - 1; index >= 0; index -= 1) {
    const match = REPLY_LINE.exec(lines[index])
    if (!match) continue
    const text = cleanRecap(match[1])
    if (text !== '' && !TOOL_CALL.test(text) && !NOTICE.test(text)) return text
  }
  return ''
}
