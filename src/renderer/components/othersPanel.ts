import { focusPane, toggleOthersPanel } from '../actions'
import type { PaneView } from '../derive'
import { clear, h, iconButton } from '../dom'
import { ICONS } from '../icons'
import { formatPercent } from '../../shared/statusLine'
import { getTerminal } from '../terminals'
import type { AppState } from '../state'
import { agentMark } from './agentMark'
import { chargeBar } from './chargeBar'

const PREVIEW_ROWS = 5
const PREVIEW_MS = 1500

function statusText(view: PaneView): string {
  if (view.attention === 'needs') return 'needs you'
  if (view.attention === 'done') return 'done'
  return view.status
}

// Last few non-empty terminal lines, so a card shows what the session is doing now.
function previewText(view: PaneView): string {
  const tail = getTerminal(view.pane.activeTabId)?.tailText(PREVIEW_ROWS * 4) ?? ''
  const lines = tail.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim() !== '')
  return lines.slice(-PREVIEW_ROWS).join('\n')
}

// Sessions that are not on screen while one pane is maximized. Open by default, collapsible to a strip.
export class OthersPanelComponent {
  readonly el = h('aside', { class: 'others-panel', 'aria-label': 'Other sessions', hidden: true })
  private signature = ''
  private previews = new Map<string, HTMLElement>()
  private others: PaneView[] = []
  private timer: number | null = null

  update(state: AppState, views: PaneView[], visibleIds: Set<string>, maximized: boolean): void {
    this.others = maximized ? views.filter((view) => !visibleIds.has(view.pane.id)) : []
    const collapsed = state.settings.othersCollapsed
    const show = this.others.length > 0
    this.el.hidden = !show
    this.el.classList.toggle('collapsed', show && collapsed)
    this.syncTimer(show && !collapsed)
    if (!show) {
      this.signature = ''
      return
    }
    const signature = JSON.stringify([
      collapsed,
      this.others.map((view) => [view.pane.id, view.pane.activeTabId, view.title, view.status, view.attention, view.agent, (view.project?.name ?? 'project'), view.info.contextPercent])
    ])
    if (signature === this.signature) return
    this.signature = signature
    if (collapsed) this.renderStrip()
    else this.renderCards()
  }

  private renderCards(): void {
    clear(this.el)
    this.previews.clear()
    const head = h(
      'div',
      { class: 'others-head' },
      h('span', { class: 'others-heading' }, 'Other sessions'),
      h('span', { class: 'others-count' }, String(this.others.length)),
      iconButton('Collapse other sessions', ICONS.expand, () => toggleOthersPanel(), 'small others-toggle')
    )
    const list = h('div', { class: 'others-list' })
    for (const view of this.others) list.append(this.card(view))
    this.el.append(head, list, h('p', { class: 'others-foot' }, 'Click a card to switch to it'))
  }

  private card(view: PaneView): HTMLElement {
    const status = statusText(view)
    const needs = view.attention === 'needs'
    const preview = h('pre', { class: 'others-preview', 'aria-hidden': 'true' }, previewText(view))
    this.previews.set(view.pane.id, preview)
    const percent = view.info.contextPercent
    const card = h(
      'article',
      { class: `others-card${needs ? ' attention' : ''}`, 'data-pane-id': view.pane.id },
      h(
        'div',
        { class: 'others-card-head' },
        agentMark(view.agent),
        h('span', { class: 'others-title' }, `${view.index + 1} · ${view.title}`),
        needs ? h('span', { class: 'attention-word needs' }, 'needs you') : h('span', { class: `status ${view.status}` }, status)
      ),
      h(
        'div',
        { class: 'others-meta' },
        ...(percent !== null ? [h('span', { class: 'others-ctx' }, 'ctx ', chargeBar(percent), formatPercent(percent))] : []),
        h('span', { class: 'others-project' }, (view.project?.name ?? 'project'))
      ),
      preview,
      h(
        'button',
        {
          class: 'btn small others-open',
          type: 'button',
          'aria-label': `Open ${view.title} in ${(view.project?.name ?? 'project')}, ${status}`,
          onClick: (event: Event) => {
            event.stopPropagation()
            focusPane(view.pane.id)
          }
        },
        'Open'
      )
    )
    card.addEventListener('click', () => focusPane(view.pane.id))
    return card
  }

  private renderStrip(): void {
    clear(this.el)
    this.previews.clear()
    this.el.append(
      iconButton('Show other sessions', ICONS.collapse, () => toggleOthersPanel(), 'others-toggle'),
      h('span', { class: 'others-strip-label', 'aria-hidden': 'true' }, 'Other sessions')
    )
    for (const view of this.others) {
      const status = statusText(view)
      const dot = view.attention === 'needs' || view.status === 'busy' ? 'busy' : view.attention === 'done' ? 'done' : 'idle'
      this.el.append(
        h(
          'button',
          {
            class: `others-chip${view.attention === 'needs' ? ' attention' : ''}`,
            type: 'button',
            title: `${view.title} · ${(view.project?.name ?? 'project')} · ${status}`,
            'aria-label': `${view.title} in ${(view.project?.name ?? 'project')}, ${status}`,
            onClick: () => focusPane(view.pane.id)
          },
          agentMark(view.agent),
          h('span', { class: `others-dot ${dot}`, 'aria-hidden': 'true' })
        )
      )
    }
  }

  private syncTimer(running: boolean): void {
    if (running && this.timer === null) {
      this.timer = window.setInterval(() => this.refreshPreviews(), PREVIEW_MS)
    } else if (!running && this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  private refreshPreviews(): void {
    for (const view of this.others) {
      const preview = this.previews.get(view.pane.id)
      if (!preview) continue
      const text = previewText(view)
      if (preview.textContent !== text) preview.textContent = text
    }
  }
}
