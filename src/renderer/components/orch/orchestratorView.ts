import { clear, h } from '../../dom'
import { openSettings } from '../../actions'
import { showOrch } from '../../orchActions'
import type { AppState, OrchTab } from '../../state'
import { OrchBoardsView } from './boardsView'
import { OrchNewRunView } from './newRunView'
import { OrchReviewView } from './reviewView'
import { OrchRunView } from './runView'
import { OrchRunsView } from './runsView'
import { OrchSpecView } from './specView'

const TABS: { id: OrchTab; label: string }[] = [
  { id: 'runs', label: 'All runs' },
  { id: 'boards', label: 'Boards' },
  { id: 'review', label: 'Human review' },
  { id: 'new', label: 'New run' }
]

/** The Orchestrator view: tabs for runs, boards, human review and starting a run, or one run's dashboard. */
export class OrchestratorViewComponent {
  readonly el = h('main', { class: 'orch-view', 'aria-label': 'Orchestrator' })
  private readonly tabs = h('div', { class: 'orch-tabs', role: 'tablist', 'aria-label': 'Orchestrator sections' })
  private readonly notice = h('div', { class: 'orch-notice', hidden: true })
  private readonly reviewBadge = h('span', { class: 'orch-badge', hidden: true })
  private readonly body = h('div', { class: 'orch-body' })
  private readonly runs = new OrchRunsView()
  private readonly boards = new OrchBoardsView()
  private readonly review = new OrchReviewView()
  private readonly newRun = new OrchNewRunView()
  private readonly run = new OrchRunView()
  private readonly spec = new OrchSpecView()
  private shown: HTMLElement | null = null

  constructor() {
    this.el.append(h('header', { class: 'orch-header' }, h('h1', { class: 'orch-title' }, 'Orchestrator'), this.tabs), this.notice, this.body)
  }

  update(state: AppState): void {
    this.renderTabs(state)
    if (!state.settings.experimental.orchestrator) return this.showOff()
    this.renderNotice(state)
    const runOpen = state.orchRunId !== null && state.orch?.runs.some((r) => r.id === state.orchRunId)
    const target = state.orchTab === 'spec' && runOpen ? this.spec : runOpen ? this.run : { runs: this.runs, boards: this.boards, review: this.review, new: this.newRun, spec: this.runs }[state.orchTab]
    this.show(target.el)
    target.update(state)
  }

  /** Tab buttons are built once and only updated, so they keep focus and stay clickable while runs change. */
  private renderTabs(state: AppState): void {
    if (this.tabs.childElementCount === 0) {
      for (const tab of TABS) {
        this.tabs.append(
          h('button', { class: 'orch-tab', type: 'button', role: 'tab', id: `orch-tab-${tab.id}`, onClick: () => showOrch(tab.id) }, tab.label)
        )
      }
      this.tabs.querySelector('#orch-tab-review')?.append(this.reviewBadge)
    }
    for (const tab of TABS) {
      const selected = state.orchRunId === null && state.orchTab === tab.id
      this.tabs.querySelector(`#orch-tab-${tab.id}`)?.setAttribute('aria-selected', String(selected))
    }
    const waiting = state.orch?.decisions.length ?? 0
    this.reviewBadge.hidden = waiting === 0
    this.reviewBadge.textContent = String(waiting)
  }

  private renderNotice(state: AppState): void {
    const status = state.orch?.status
    const problem = status?.error ? `The orchestrator could not start: ${status.error}` : status && !status.running ? 'The orchestrator is starting…' : null
    this.notice.hidden = !problem
    this.notice.textContent = problem ?? ''
  }

  private showOff(): void {
    this.notice.hidden = true
    const off = h(
      'section',
      { class: 'orch-empty' },
      h('h2', {}, 'The orchestrator is off'),
      h('p', {}, 'It is an experimental feature for local builds. Turn it on to plan work with a lead agent and run other agents in their own panes.'),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openSettings('experimental') }, 'Open Settings → Experimental')
    )
    this.show(off)
  }

  private show(el: HTMLElement): void {
    if (this.shown === el) return
    clear(this.body)
    this.body.append(el)
    this.shown = el
  }
}
