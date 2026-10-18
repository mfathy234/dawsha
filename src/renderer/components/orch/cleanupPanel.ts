import type { OrchRunDetail } from '../../../shared/orch/api'
import { h } from '../../dom'
import { retryCleanup } from '../../orchActions'

/** What clearing a finished run's worktrees did, with a Retry button when something could not be removed. */
export function cleanupPanel(run: Pick<OrchRunDetail, 'id' | 'stage' | 'cleanup' | 'imported'>): HTMLElement | null {
  const { cleanup } = run
  if (!cleanup || run.imported) return null
  const count = `Cleaned up ${cleanup.removed} worktree${cleanup.removed === 1 ? '' : 's'}`
  const deleted = cleanup.deletedBranches.length ? ` and deleted ${cleanup.deletedBranches.length} merged branch${cleanup.deletedBranches.length === 1 ? '' : 'es'}` : ''
  const retry = cleanup.failed.length > 0 || cleanup.kept.length > 0
  return h('div', { class: 'orch-cleanup', role: 'status' },
    h('p', { class: cleanup.failed.length ? 'orch-warn' : 'orch-muted' }, `${count}${deleted}.`),
    cleanup.failed.length ? h('p', {}, 'Could not remove:') : null,
    cleanup.failed.length ? h('ul', {}, ...cleanup.failed.map((text) => h('li', {}, text))) : null,
    cleanup.kept.length ? h('p', {}, 'Left on disk on purpose:') : null,
    cleanup.kept.length ? h('ul', {}, ...cleanup.kept.map((text) => h('li', {}, text))) : null,
    retry ? h('button', { class: 'btn orch-small', type: 'button', onClick: () => void retryCleanup(run.id) }, 'Retry clean-up') : null)
}
