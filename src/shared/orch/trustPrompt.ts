import { stripAnsi } from './quota'

// Claude Code asks "Is this a project you trust?" the first time it opens a folder. Orchestrator agents always
// open in a worktree Dawsha just created from the user's own project, so with the user's consent (turning on
// the orchestrator and the auto-trust switch) Dawsha answers it - for that exact folder and nothing else.

export const TRUST_DOWN = '\x1b[B'
export const TRUST_ENTER = '\r'

export type TrustStep = 'down' | 'enter'

// Whitespace is ignored: Claude wraps a long path at a space, and the wrap loses that space.
const normalizePath = (path: string): string => path.replace(/\s+/g, '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()

/**
 * The next keystroke towards "Yes, I trust this folder" for exactly `folder`, read from the rendered screen:
 * 'down' while the cursor is on "No, exit", 'enter' only once it is on "Yes". Null when this is not that prompt.
 * Enter is never suggested while the cursor is on "No", so a lost keystroke cannot make Claude exit.
 */
export function trustPromptStep(runner: string, screen: string, folder: string): TrustStep | null {
  if (runner === 'codex') return codexTrustStep(screen, folder)
  if (runner !== 'claude') return null
  const lines = stripAnsi(screen).split(/\r?\n/).map((line) => line.trim())
  const at = lines.lastIndexOf('Accessing workspace:')
  if (at < 0) return null
  // A long path wraps over several lines on a narrow pane; it ends where the safety text starts.
  const end = lines.findIndex((line, i) => i > at && line.startsWith('Quick safety check'))
  if (end < 0 || normalizePath(lines.slice(at + 1, end).join('')) !== normalizePath(folder)) return null
  const rest = lines.slice(end)
  const yes = rest.findIndex((line) => /^(❯\s*)?Yes, I trust this folder$/.test(line))
  const no = rest.findIndex((line) => /^(❯\s*)?No, exit$/.test(line))
  if (yes < 0 || no < 0 || !rest.some((line) => line.startsWith('Enter to confirm'))) return null
  if (rest[yes].startsWith('❯')) return 'enter'
  return rest[no].startsWith('❯') && yes === no + 1 ? 'down' : null
}

/**
 * Codex asks "Folder access … Trust this folder?" with "1. Trust and continue" selected and "2. Quit" below it.
 * Enter only while the cursor is on "Trust and continue" for exactly `folder`; anything else is left alone.
 */
function codexTrustStep(screen: string, folder: string): TrustStep | null {
  const lines = stripAnsi(screen).split(/\r?\n/).map((line) => line.trim())
  const at = lines.lastIndexOf('Folder access')
  if (at < 0) return null
  // The path (wrapped on a narrow pane) runs until the first blank line.
  const blank = lines.findIndex((line, i) => i > at && line === '')
  if (blank < 0 || normalizePath(lines.slice(at + 1, blank).join('')) !== normalizePath(folder)) return null
  const rest = lines.slice(blank)
  if (!rest.some((line) => line.startsWith('Trust this folder?')) || !rest.some((line) => /^enter continue/.test(line))) return null
  const trust = rest.findIndex((line) => /^(›\s*)?1\. Trust and continue$/.test(line))
  return trust >= 0 && rest[trust].startsWith('›') ? 'enter' : null
}
