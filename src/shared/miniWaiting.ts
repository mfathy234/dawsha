import { parseMenuPrompt } from './menuPrompt'
import { detectPermissionPrompt } from './permissionPrompt'
import { detectTerminalMenu } from './terminalMenu'

/** What a waiting session waits on when it is not a tool-permission prompt. */
export interface MiniWaiting {
  /** A numbered picker or menu blocks the reply box; a plain question does not. */
  kind: 'menu' | 'question'
  question: string
  choices: string[]
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\[[0-9;?]*[ -/]*[@-~]`, 'g')
const NUMBERED = /^[\s│┃|]*[❯›▸▶●◉>]?\s*(\d{1,2})[.)]\s+(\S.*)$/
const QUESTION_MAX = 240
const CHOICE_MAX = 160
const CHOICES_MAX = 8
const FALLBACK = 'The agent is waiting for you. Open the session to see what it needs.'

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function screenRows(tail: string): string[] {
  return tail.replace(ANSI, '').split('\n').map(line => NUMBERED.exec(line.replace(/\r/g, '')))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => `${match[1]}. ${clip(match[2], CHOICE_MAX)}`)
    .slice(-CHOICES_MAX)
}

/** The sentence of the agent's last reply that asks something, else its last line. */
function questionFromReply(reply: readonly string[]): string {
  const lines = reply.map(line => line.trim()).filter(line => line !== '')
  const asking = lines.findLast(line => /[?؟]\s*$/.test(line))
  return clip(asking ?? lines.at(-1) ?? '', QUESTION_MAX)
}

/**
 * Why a session that needs you shows no approval box: the numbered picker on its screen, a menu chat cannot draw,
 * or a plain question in its last reply. Always returns something to show, so the detail never says "waiting" about nothing.
 * Null only for a tool-permission prompt, which has its own approval box.
 */
export function miniWaiting(tail: string, reply: readonly string[]): MiniWaiting | null {
  if (detectPermissionPrompt(tail)) return null
  const prompt = parseMenuPrompt(tail)
  const asked = prompt?.questions[0]
  if (asked) {
    const choices = [...asked.options.map(option => `${option.number}. ${clip(option.label, CHOICE_MAX)}`),
      ...(asked.otherNumber !== null ? [`${asked.otherNumber}. Something else`] : [])].slice(0, CHOICES_MAX)
    return { kind: 'menu', question: clip(asked.question, QUESTION_MAX) || FALLBACK, choices }
  }
  if (detectTerminalMenu(tail)) return { kind: 'menu', question: 'A menu is open in the session.', choices: screenRows(tail) }
  return { kind: 'question', question: questionFromReply(reply) || FALLBACK, choices: [] }
}
