import { SESSION_STATE_LABELS, type SessionState } from '../../shared/sessionState'
import { h, icon } from '../dom'

// Each state differs by shape as well as colour, so it reads in grayscale too.
const STATE_SVGS: Record<SessionState, string> = {
  needs:
    '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M6 .8 11.2 6 6 11.2.8 6z" fill="currentColor"/><path d="M6 3.5v3" stroke="var(--state-ink)" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="8.4" r=".8" fill="var(--state-ink)"/></svg>',
  working:
    '<svg viewBox="0 0 12 12" width="12" height="12" class="state-spin"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="2"/><path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  done:
    '<svg viewBox="0 0 12 12" width="12" height="12"><circle cx="6" cy="6" r="5.5" fill="currentColor"/><path d="M3.5 6.2l1.8 1.8 3.3-3.6" stroke="var(--state-ink)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  idle: '<svg viewBox="0 0 12 12" width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  exited:
    '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="1" y="1" width="10" height="10" rx="2.5" fill="currentColor"/><path d="M4 4l4 4M8 4l-4 4" stroke="var(--state-ink)" stroke-width="1.5" stroke-linecap="round"/></svg>'
}

/** The bare state icon. Colour comes from the `state-<name>` class (see styles.css). */
export function stateIcon(state: SessionState): HTMLElement {
  const el = icon(STATE_SVGS[state])
  el.classList.add('state-icon', `state-${state}`)
  return el
}

/** Icon plus word, e.g. "Needs you · 2m". */
export function statePill(state: SessionState, suffix = ''): HTMLElement {
  const text = suffix ? `${SESSION_STATE_LABELS[state]} · ${suffix}` : SESSION_STATE_LABELS[state]
  return h('span', { class: `state-pill state-${state}` }, stateIcon(state), h('span', { class: 'state-pill-text' }, text))
}
