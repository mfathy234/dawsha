import type { TodoEntry } from './chatCards'

export interface PlanProgress {
  done: number
  total: number
  /** "3 of 7". */
  label: string
  /** 0 to 100, for the thin bar. */
  percent: number
  /** The task being worked on now; the first one not yet done when none is marked. */
  current: string
}

interface PlanItem {
  kind: string
  activity?: string
  verb?: string
  todos?: readonly TodoEntry[]
}

/**
 * The agent's checklist as it stands now: the last TodoWrite call in the log. A call with no tasks
 * clears the list, so the answer is empty then, not the list before it.
 */
export function latestTodos(items: readonly PlanItem[]): readonly TodoEntry[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind === 'tool' && item.activity === 'todo' && item.verb === 'Todos') return item.todos ?? []
  }
  return []
}

/** How far along the list is, or null when there is no list or every task is done (the bar hides then). */
export function planProgress(todos: readonly TodoEntry[]): PlanProgress | null {
  const total = todos.length
  const done = todos.filter((todo) => todo.status === 'completed').length
  if (total === 0 || done === total) return null
  const active = todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status !== 'completed')
  return { done, total, label: `${done} of ${total}`, percent: Math.round((done / total) * 100), current: active?.text ?? '' }
}
