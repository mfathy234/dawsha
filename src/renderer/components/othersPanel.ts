import { answerPermission, focusPane, openChanges, toggleOthersPanel } from '../actions'
import type { PaneView } from '../derive'
import { clear, h, iconButton } from '../dom'
import { ICONS } from '../icons'
import { sessionState, type SessionState } from '../../shared/sessionState'
import { bind, formatShortcut } from '../../shared/shortcuts'
import { cardSummary, lastLines, sortByUrgency, stateWord } from '../../shared/topbarSummary'
import { timeInState } from '../stateClock'
import { getTerminal } from '../terminals'
import type { AppState } from '../state'
import { agentMark } from './agentMark'
import { stateIcon } from './stateIcon'

const PREVIEW_LINES = 2
const PREVIEW_MS = 1500
const NEXT_KEY = formatShortcut(bind('Ctrl+Shift+J'))

interface Entry {
  view: PaneView
  state: SessionState
}

function previewLines(view: PaneView): string[] {
  return lastLines(getTerminal(view.pane.activeTabId)?.tailText(PREVIEW_LINES * 6) ?? '', PREVIEW_LINES)
}

function fillPreview(preview: HTMLElement, lines: string[]): void {
  preview.replaceChildren(...lines.map((line) => h('span', { class: 'others-line' }, line)))
}

// Sessions that are not on screen while one pane is maximized. Open by default, collapsible to a strip.
export class OthersPanelComponent {
  readonly el = h('aside', { class: 'others-panel', 'aria-label': 'Other sessions', hidden: true })
  private signature = ''
  private previews = new Map<string, HTMLElement>()
  private others: Entry[] = []
  private timer: number | null = null

  update(state: AppState, views: PaneView[], visibleIds: Set<string>, maximized: boolean): void {
    const hidden = maximized ? views.filter((view) => !visibleIds.has(view.pane.id)) : []
    this.others = sortByUrgency(hidden.map((view) => ({ view, state: sessionState(view) })))
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
      this.others.map(({ view, state: s }) => [view.pane.id, view.pane.activeTabId, view.title, s, stateWord(s, timeInState(view.pane.id, s, view.now)), view.agent, view.project?.name ?? 'project', cardSummary(view)])
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
    for (const entry of this.others) list.append(this.card(entry))
    this.el.append(head, list, h('p', { class: 'others-foot' }, `Sorted by what needs you first. ${NEXT_KEY} jumps to the next one.`))
  }

  private actions(entry: Entry): HTMLElement[] {
    const { view, state } = entry
    const stop = (run: () => void) => (event: Event) => {
      event.stopPropagation()
      run()
    }
    const title = `${view.title} in ${view.project?.name ?? 'project'}`
    const open = h(
      'button',
      { class: 'btn small others-open', type: 'button', 'aria-label': `Switch to ${title}`, onClick: stop(() => focusPane(view.pane.id)) },
      'Switch to it'
    )
    if (state === 'needs') {
      return [
        h('button', { class: 'btn small primary others-allow', type: 'button', 'aria-label': `Allow for ${title}`, onClick: stop(() => answerPermission(view.pane.id, true)) }, 'Allow'),
        h('button', { class: 'btn small others-deny', type: 'button', 'aria-label': `Deny for ${title}`, onClick: stop(() => answerPermission(view.pane.id, false)) }, 'Deny'),
        open
      ]
    }
    if (state === 'done') {
      return [h('button', { class: 'btn small primary others-review', type: 'button', 'aria-label': `Review changes in ${title}`, onClick: stop(() => void openChanges(view.pane.id)) }, 'Review changes'), open]
    }
    return [open]
  }

  private card(entry: Entry): HTMLElement {
    const { view, state } = entry
    const word = stateWord(state, timeInState(view.pane.id, state, view.now))
    const summary = cardSummary(view)
    const project = view.project?.name ?? 'project'
    const preview = h('div', { class: 'others-preview', 'aria-hidden': 'true' })
    fillPreview(preview, previewLines(view))
    this.previews.set(view.pane.id, preview)
    const card = h(
      'article',
      { class: `others-card state-card-${state}${state === 'needs' ? ' attention' : ''}`, 'data-pane-id': view.pane.id, 'data-state': state },
      h(
        'div',
        { class: 'others-card-head' },
        stateIcon(state),
        agentMark(view.agent),
        h('span', { class: 'others-title' }, `${view.index + 1} · `, h('bdi', { dir: 'auto' }, view.title)),
        h('span', { class: `others-state state-${state}` }, word)
      ),
      h('div', { class: 'others-meta' }, h('span', { class: 'others-project' }, summary ? `${project} · ${summary}` : project)),
      preview,
      h('div', { class: 'others-actions' }, ...this.actions(entry))
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
    for (const { view, state } of this.others) {
      const status = stateWord(state, '')
      const project = view.project?.name ?? 'project'
      this.el.append(
        h(
          'button',
          {
            class: `others-chip${state === 'needs' ? ' attention' : ''}`,
            type: 'button',
            title: `${view.title} · ${project} · ${status}`,
            'aria-label': `${view.title} in ${project}, ${status}`,
            onClick: () => focusPane(view.pane.id)
          },
          agentMark(view.agent),
          stateIcon(state)
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
    for (const { view } of this.others) {
      const preview = this.previews.get(view.pane.id)
      if (!preview) continue
      const lines = previewLines(view)
      if (lines.join('\n') !== Array.from(preview.children, (child) => child.textContent).join('\n')) fillPreview(preview, lines)
    }
  }
}
