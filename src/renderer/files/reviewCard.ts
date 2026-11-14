import { h } from '../dom'
import './reviewLoop.css'

export type ReviewCardState = 'running' | 'done' | 'failed'

export interface ReviewCardModel {
  state: ReviewCardState
  /** "Codex" or "Claude". */
  reviewer: string
  scope: string
  summary: string
  open: number
  raw: string
}

export interface ReviewCardHooks {
  fixAll(): void
  dismissAll(): void
  cancel(): void
  retry(): void
  open(): void
}

/** The reviewer's summary card: running, "3 findings: 1 high, 2 low" with Fix all and Dismiss, or the raw reply when it could not be read. */
export function reviewCard(model: ReviewCardModel, hooks: ReviewCardHooks): HTMLElement {
  const title = h('div', { class: 'review-card-title' }, model.state === 'running' ? `${model.reviewer} is reviewing ${model.scope}` : `Review by ${model.reviewer}`)
  const body = h('div', { class: 'review-card-body', role: 'status', 'aria-live': 'polite' })
  const actions = h('div', { class: 'review-card-actions' })
  const button = (label: string, run: () => void, id: string): HTMLElement => h('button', { class: 'btn small', type: 'button', id, onClick: run }, label)
  if (model.state === 'running') {
    body.append('Reading the changes in read-only plan mode.')
    actions.append(button('Show the reviewer', hooks.open, 'review-card-open'), button('Cancel', hooks.cancel, 'review-card-cancel'))
  } else if (model.state === 'failed') {
    body.append('The reply could not be read as findings. Here it is as it came:')
    body.append(h('pre', { class: 'review-card-raw', dir: 'auto' }, model.raw.trim() === '' ? '(empty reply)' : model.raw.slice(0, 4000)))
    actions.append(button('Review again', hooks.retry, 'review-card-retry'), button('Dismiss', hooks.dismissAll, 'review-card-dismiss'))
  } else {
    body.append(model.summary)
    if (model.open > 0) actions.append(button(`Fix all (${model.open})`, hooks.fixAll, 'review-card-fix'), button('Dismiss all', hooks.dismissAll, 'review-card-dismiss'))
    else actions.append(button('Close', hooks.dismissAll, 'review-card-dismiss'))
  }
  return h('section', { class: `review-card ${model.state}`, id: 'review-card', 'aria-label': 'Review' }, title, body, actions)
}
