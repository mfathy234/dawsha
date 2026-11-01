import { detectPermissionPrompt } from './permissionPrompt'

const TAIL_LINES = 24
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const HINT = /(?:enter|return)\s+to\s+(?:confirm|select|choose|continue|apply)|press\s+enter\s+to|esc(?:ape)?\s+to\s+(?:cancel|exit|go\s+back|close|dismiss)|[↑↓]\s*\/?\s*[↑↓]|arrow\s+keys|use\s+↑/i
const CHOSEN_ROW = /^[\s│┃|]*[❯▸▶◉]\s+\S/
const NUMBERED_ROW = /^[\s│┃|]*[❯›▸▶●◉>]?\s*\d{1,2}[.)]\s+\S/

/**
 * True when the agent's screen shows a menu or picker (a model list, a resume list, a settings screen) that chat has no way to draw.
 * A permission prompt is not one: it has its own card.
 */
export function detectTerminalMenu(tail: string): boolean {
  const text = tail.replace(ANSI, '')
  if (detectPermissionPrompt(text)) return false
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\r/g, ''))
    .filter((line) => line.trim() !== '')
    .slice(-TAIL_LINES)
  if (!lines.some((line) => HINT.test(line))) return false
  const numbered = lines.filter((line) => NUMBERED_ROW.test(line)).length
  return numbered >= 2 || lines.some((line) => CHOSEN_ROW.test(line))
}
