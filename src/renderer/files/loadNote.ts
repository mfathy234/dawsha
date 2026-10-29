import { h, icon } from '../dom'

const SPINNER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3a9 9 0 1 1-9 9" /></svg>'

/** A small spinner and words. It fades in after about 150ms (CSS), so a fast load never flashes it. */
export function loadingNote(text: string, extra: HTMLElement[] = []): HTMLElement {
  return h('div', { class: 'files-loading', role: 'status' }, h('span', { class: 'files-spinner', 'aria-hidden': 'true' }, icon(SPINNER)), h('span', { class: 'files-loading-text' }, text), ...extra)
}

/** Quiet placeholder rows with the words "Loading …" above them; also revealed after about 150ms. */
export function skeletonRows(text: string, rows = 7): HTMLElement {
  const widths = [64, 82, 48, 74, 58, 70, 44]
  return h('div', { class: 'files-loading files-skeleton', role: 'status' },
    h('span', { class: 'files-loading-text' }, text),
    ...Array.from({ length: rows }, (_, index) => h('span', { class: 'files-skel-row', 'aria-hidden': 'true', style: `width:${widths[index % widths.length]}%` })))
}

/** A plain message with a Retry button; `detail` is an optional second line (what is allowed, what to try). */
export function errorNote(message: string, retry: () => void, detail = ''): HTMLElement {
  return h('div', { class: 'files-error', role: 'alert' },
    h('p', { class: 'files-error-text' }, message),
    ...(detail ? [h('p', { class: 'files-error-detail' }, detail)] : []),
    h('button', { class: 'btn small files-retry', type: 'button', onClick: retry }, 'Retry'))
}
