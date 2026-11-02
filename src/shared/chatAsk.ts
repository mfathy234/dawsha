/** A question an agent asks the user through a picker: AskUserQuestion in Claude, or any numbered menu on the screen. */
export interface AskOption {
  /** The number the picker shows next to it, which is the key that chooses it. */
  number: number
  label: string
  description: string
}

export interface AskQuestion {
  header: string
  question: string
  multiSelect: boolean
  options: AskOption[]
  /** The number of the "type something" row, or null when the picker has none. */
  otherNumber: number | null
}

export interface AskPrompt {
  id: string
  questions: AskQuestion[]
}

const QUESTIONS_MAX = 4
const OPTIONS_MAX = 12
const TEXT_MAX = 600

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const clip = (value: unknown, max = TEXT_MAX): string => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function optionOf(raw: unknown, index: number): AskOption | null {
  const source = isRecord(raw) ? raw : { label: raw }
  const label = clip(source.label)
  return label === '' ? null : { number: index + 1, label, description: clip(source.description) }
}

function questionOf(raw: unknown): AskQuestion | null {
  if (!isRecord(raw)) return null
  const question = clip(raw.question)
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .slice(0, OPTIONS_MAX)
    .map(optionOf)
    .filter((option): option is AskOption => option !== null)
    .map((option, index) => ({ ...option, number: index + 1 }))
  if (question === '' || options.length < 2) return null
  return { header: clip(raw.header, 40), question, multiSelect: raw.multiSelect === true, options, otherNumber: options.length + 1 }
}

/** The questions in an AskUserQuestion call's input. The picker adds its own "type something" row after the options. */
export function parseAskQuestions(input: unknown): AskQuestion[] {
  const list = isRecord(input) && Array.isArray(input.questions) ? input.questions : []
  const shown = list.slice(0, QUESTIONS_MAX)
  const parsed = shown.map(questionOf).filter((question): question is AskQuestion => question !== null)
  // A question that cannot be read would put the picker out of step with the card, so none is shown.
  return parsed.length === shown.length ? parsed : []
}
