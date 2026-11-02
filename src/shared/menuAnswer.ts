import type { AskQuestion } from './chatAsk'

/** One write to the agent's terminal and how long to wait before the next. */
export interface KeyStep {
  data: string
  wait: number
}

/** What the user picked for one question: option numbers, and text for the "type something" row. */
export interface AskAnswer {
  numbers: number[]
  other: string
}

export const KEY_GAP_MS = 70
export const NEXT_QUESTION_MS = 350
const DOWN = '\u001b[B'
const ENTER = '\r'
const SPACE = ' '
const DIGIT_MAX = 9

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Choosing a row: its number when one key can name it, else arrows down from the first row and Enter. */
function choose(number: number): KeyStep[] {
  if (number <= DIGIT_MAX) return [{ data: String(number), wait: KEY_GAP_MS }]
  return [...Array.from({ length: number - 1 }, () => ({ data: DOWN, wait: 20 })), { data: ENTER, wait: KEY_GAP_MS }]
}

/** The row of "type something": choose it, type the words, press Enter. */
function typeOther(number: number, text: string): KeyStep[] {
  return [...choose(number), { data: oneLine(text), wait: KEY_GAP_MS }, { data: ENTER, wait: KEY_GAP_MS }]
}

/** A many-choice question has no single key: walk down with arrows, Space on each pick, then Enter. */
function chooseMany(numbers: readonly number[]): KeyStep[] {
  const steps: KeyStep[] = []
  let row = 1
  for (const number of [...numbers].sort((a, b) => a - b)) {
    for (; row < number; row += 1) steps.push({ data: DOWN, wait: 20 })
    steps.push({ data: SPACE, wait: KEY_GAP_MS })
  }
  steps.push({ data: ENTER, wait: KEY_GAP_MS })
  return steps
}

/** The keys that answer one question. Empty when nothing was picked. */
export function planQuestion(question: AskQuestion, answer: AskAnswer): KeyStep[] {
  const text = oneLine(answer.other)
  if (text !== '' && question.otherNumber !== null) return typeOther(question.otherNumber, text)
  if (answer.numbers.length === 0) return []
  if (question.multiSelect) return chooseMany(answer.numbers)
  return choose(answer.numbers[0])
}

/** Every question in order, with a pause after each for the picker to move to the next. */
export function planAnswers(questions: readonly AskQuestion[], answers: readonly AskAnswer[]): KeyStep[] {
  return questions.flatMap((question, index) => {
    const steps = planQuestion(question, answers[index] ?? { numbers: [], other: '' })
    return steps.length === 0 ? [] : [...steps.slice(0, -1), { ...steps[steps.length - 1], wait: NEXT_QUESTION_MS }]
  })
}

/** True when every question has a pick or some text. */
export function isAnswered(questions: readonly AskQuestion[], answers: readonly AskAnswer[]): boolean {
  return questions.length > 0 && questions.every((question, index) => planQuestion(question, answers[index] ?? { numbers: [], other: '' }).length > 0)
}

/** The key that confirms a review screen, once its row number is known. */
export function submitSteps(number: number): KeyStep[] {
  return choose(number)
}
