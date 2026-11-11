import { checksFinished, failedChecks, statusText, type CheckResult } from '../../shared/turnChecks'
import { h } from '../dom'
import { present } from '../components/dialogs'
import type { ChecksState } from './turnState'
import './turnExtras.css'

const STATE_WORD: Readonly<Record<CheckResult['status'], string>> = { queued: 'Waiting', running: 'Running', passed: 'Passed', failed: 'Failed' }

function row(result: CheckResult): HTMLElement[] {
  const rows: HTMLElement[] = [
    h('div', { class: 'turn-check', 'data-status': result.status },
      h('span', { class: `turn-dot ${result.status}`, role: 'img', 'aria-label': STATE_WORD[result.status] }),
      h('span', { class: 'mono turn-check-cmd', dir: 'ltr', title: result.display }, result.display),
      h('span', { class: 'turn-spacer' }),
      h('span', { class: `turn-check-state${result.status === 'failed' ? ' fail' : ''}`, role: 'status' }, statusText(result)))
  ]
  if (result.status === 'failed' && result.excerpt) rows.push(h('pre', { class: 'turn-check-out', dir: 'ltr', tabindex: 0, 'aria-label': `Output of ${result.display}` }, result.excerpt))
  return rows
}

/** A row per check: a dot, the command, and what happened; the failing lines sit under a failure. */
export function checksSection(state: ChecksState | null): HTMLElement | null {
  if (!state || state.results.length === 0) return null
  return h('div', { class: 'turn-checks', role: 'group', 'aria-label': 'Checks after this reply' }, ...state.results.flatMap(row))
}

export const hasFailures = (state: ChecksState | null): boolean => !!state && checksFinished(state.results) && failedChecks(state.results).length > 0
export const hasOutput = (state: ChecksState | null): boolean => !!state && state.results.some((result) => result.output !== '')

/** The end of each failing check's output in a dialog (or of every check when none failed). */
export function showFullOutput(state: ChecksState): void {
  const failed = failedChecks(state.results)
  const shown = (failed.length > 0 ? failed : state.results).filter((result) => result.output !== '')
  const close = h('button', { class: 'btn primary', type: 'button' }, 'Close')
  const dialog = h('div', { class: 'dialog turn-output-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Check output' },
    h('h2', {}, 'Check output'),
    ...shown.flatMap((result) => [h('h3', { class: 'mono' }, result.display), h('pre', { class: 'turn-output', dir: 'ltr', tabindex: 0 }, result.output)]),
    h('div', { class: 'dialog-actions' }, close))
  const shownDialog = present<null>(dialog, null, close)
  close.addEventListener('click', () => shownDialog.finish(null))
}
