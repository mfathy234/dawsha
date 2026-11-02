import type { AnswerEntry, TodoEntry } from '../../shared/chatCards'
import { textDirection } from '../../shared/chatLog'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { h } from '../dom'
import { richText } from './chatText'

const MARK: Readonly<Record<TodoEntry['status'], string>> = { pending: '☐', in_progress: '◐', completed: '☑' }
const STATUS: Readonly<Record<TodoEntry['status'], string>> = { pending: CHAT_TEXT.todoPending, in_progress: CHAT_TEXT.todoActive, completed: CHAT_TEXT.todoDone }

/** A TodoWrite call as the checklist it is. Each task's state is also said in words, not only by its mark. */
export function todoCard(todos: readonly TodoEntry[]): HTMLElement {
  return h(
    'ul',
    { class: 'chat-todos', dir: 'auto', 'aria-label': CHAT_TEXT.todoLabel },
    ...todos.map((todo) =>
      h('li', { class: `todo ${todo.status}` }, h('span', { class: 'mark', 'aria-hidden': 'true' }, MARK[todo.status]), h('span', { class: 'sr-only' }, `${STATUS[todo.status]}: `), h('span', { class: 'txt' }, todo.text))
    )
  )
}

/** What was asked and what was chosen. */
export function answersCard(answers: readonly AnswerEntry[]): HTMLElement {
  return h(
    'dl',
    { class: 'chat-answers', dir: 'auto' },
    ...answers.flatMap((entry) => [h('dt', {}, entry.question), h('dd', {}, entry.answer)])
  )
}

/** Markdown the agent wrote, shown as a reply: a plan, or what a sub-agent reported back. */
export function markdownCard(text: string): HTMLElement {
  return h('div', { class: 'chat-say chat-card', dir: textDirection(text) }, ...richText(text))
}
