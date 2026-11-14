import { REVIEW_SCOPES, reviewerChoices, type ReviewScope } from '../../shared/reviewFindings'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'
import '../files/reviewLoop.css'

export interface ReviewChoice {
  reviewer: AgentKind
  scope: ReviewScope
}

export interface ReviewDialogOptions {
  author: AgentKind
  title: string
  scope: ReviewScope
}

function group(name: string, legend: string, options: { value: string; label: string; detail?: string; checked: boolean }[]): HTMLElement {
  const id = nextDialogId()
  return h('fieldset', { class: 'review-dialog-group' },
    h('legend', {}, legend),
    ...options.map((option, index) => h('label', { class: 'review-dialog-choice', for: `rv-${id}-${index}` },
      h('input', { type: 'radio', name: `${name}-${id}`, id: `rv-${id}-${index}`, value: option.value, checked: option.checked }),
      h('span', {}, option.label, option.detail ? h('span', { class: 'review-dialog-detail' }, ` ${option.detail}`) : null))))
}

/** Who reviews and what they look at. Resolves with the choice, or null on cancel. */
export function reviewDialog(options: ReviewDialogOptions): Promise<ReviewChoice | null> {
  const choices = reviewerChoices(options.author)
  const who = group('who', 'Reviewer', choices.map((choice, index) => ({ value: choice.agent + (index === 1 ? ':same' : ''), label: choice.label, checked: index === 0 })))
  const what = group('what', 'What to review', REVIEW_SCOPES.map((scope) => ({ value: scope.id, label: scope.label, detail: scope.detail, checked: scope.id === options.scope })))
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const start = h('button', { class: 'btn primary', type: 'button', id: 'review-start', 'data-confirm': '' }, 'Start review')
  const dialog = h('div', { class: 'dialog review-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Review this session' },
    h('h2', {}, 'Review this session'),
    h('p', {}, `${options.title}. The reviewer runs in read-only plan mode and reads the changes in the background.`),
    h('div', { class: 'review-dialog-options' }, who, what),
    h('div', { class: 'dialog-actions' }, cancel, start))
  const shown = present<ReviewChoice | null>(dialog, null, start)
  cancel.addEventListener('click', () => shown.finish(null))
  start.addEventListener('click', () => {
    const picked = who.querySelector<HTMLInputElement>('input:checked')?.value ?? ''
    const scope = (what.querySelector<HTMLInputElement>('input:checked')?.value ?? options.scope) as ReviewScope
    const index = choices.findIndex((choice, at) => choice.agent + (at === 1 ? ':same' : '') === picked)
    shown.finish({ reviewer: choices[Math.max(0, index)].agent, scope })
  })
  return shown.result
}
