export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoEntry {
  text: string
  status: TodoStatus
}

export interface AnswerEntry {
  question: string
  answer: string
}

const TODOS_MAX = 60
const TEXT_MAX = 240
export const PLAN_MAX = 24_000

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const clip = (value: unknown, max = TEXT_MAX): string => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

/** The checklist in a TodoWrite call's input. The line shown is the task itself; the active form ("Running tests") only fills in for a task with no text. */
export function parseTodos(input: unknown): TodoEntry[] {
  const list = isRecord(input) && Array.isArray(input.todos) ? input.todos : []
  return list.slice(0, TODOS_MAX).flatMap((raw): TodoEntry[] => {
    if (!isRecord(raw)) return []
    const text = clip(raw.content) || clip(raw.activeForm) || clip(raw.text)
    const status = typeof raw.status === 'string' && STATUSES.includes(raw.status) ? (raw.status as TodoStatus) : 'pending'
    return text === '' ? [] : [{ text, status }]
  })
}

export function todoSummary(todos: readonly TodoEntry[]): string {
  const done = todos.filter((todo) => todo.status === 'completed').length
  return `${done} of ${todos.length} done`
}

/** The answers Claude records for an AskUserQuestion: question text to the label (or typed text) that was chosen. */
export function parseAnswers(result: unknown): AnswerEntry[] {
  const answers = isRecord(result) && isRecord(result.answers) ? result.answers : {}
  return Object.entries(answers).flatMap(([question, answer]): AnswerEntry[] => {
    const text = Array.isArray(answer) ? answer.filter((part): part is string => typeof part === 'string').join(', ') : clip(answer)
    return question.trim() !== '' && text !== '' ? [{ question: question.trim().slice(0, TEXT_MAX), answer: text.slice(0, TEXT_MAX) }] : []
  })
}

/** The markdown plan an ExitPlanMode call carries. */
export function parsePlan(input: unknown): string {
  return isRecord(input) && typeof input.plan === 'string' ? input.plan.trim().slice(0, PLAN_MAX) : ''
}
