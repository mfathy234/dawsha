import type { TodoEntry } from '../../shared/chatCards'
import { planProgress } from '../../shared/planProgress'
import { clear, h, icon } from '../dom'
import { ICONS } from '../icons'
import { todoCard } from './chatCards'
import './chatPlanBar.css'

/**
 * The agent's checklist pinned above the thread as one line: how far along it is and what it is doing now.
 * Click it to open the whole list (the same marks and words as the todo card), click again to close.
 * It hides when the list is empty or every task is done.
 */
export class ChatPlanBar {
  readonly el = h('div', { class: 'chat-plan', hidden: true })
  private readonly bar = h('button', { class: 'plan-bar', type: 'button', 'aria-expanded': 'false', onClick: () => this.toggle() })
  private readonly list = h('div', { class: 'plan-list', id: `plan-list-${Math.random().toString(36).slice(2, 8)}`, hidden: true })
  private open = false
  private todos: readonly TodoEntry[] = []
  private signature = ''

  constructor() {
    this.bar.setAttribute('aria-controls', this.list.id)
    this.el.append(this.bar, this.list)
  }

  /** The label shown ("3 of 7"), or empty while the bar is hidden. */
  update(todos: readonly TodoEntry[]): string {
    const plan = planProgress(todos)
    if (!plan) {
      this.hide()
      return ''
    }
    const signature = JSON.stringify([todos, this.open])
    if (signature !== this.signature) {
      this.signature = signature
      this.draw(todos, plan)
    }
    this.el.hidden = false
    return plan.label
  }

  private hide(): void {
    this.el.hidden = true
    this.open = false
    this.signature = ''
  }

  private toggle(): void {
    this.open = !this.open
    const plan = planProgress(this.todos)
    if (plan) this.draw(this.todos, plan)
  }

  private listChildren(): HTMLElement[] {
    return [todoCard(this.todos)]
  }

  private draw(todos: readonly TodoEntry[], plan: NonNullable<ReturnType<typeof planProgress>>): void {
    this.todos = todos
    const now = plan.current === '' ? '' : plan.current
    this.bar.setAttribute('aria-label', `Plan, ${plan.label} done${now ? `. Now: ${now}` : ''}. ${this.open ? 'Hide' : 'Show'} the checklist`)
    this.bar.setAttribute('aria-expanded', String(this.open))
    clear(this.bar)
    this.bar.append(
      h('span', { class: 'plan-n', 'aria-hidden': 'true' }, plan.label),
      h('span', { class: 'plan-prog', 'aria-hidden': 'true' }, h('i', { style: `width: ${plan.percent}%` })),
      h('span', { class: 'plan-now', dir: 'auto', 'aria-hidden': 'true' }, now),
      icon(this.open ? ICONS.chevronUp : ICONS.chevronDown)
    )
    this.list.hidden = !this.open
    if (this.open) this.list.replaceChildren(...this.listChildren())
  }
}
