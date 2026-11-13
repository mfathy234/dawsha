import { openChanges, saveSettings } from '../actions'
import type { TodoEntry } from '../../shared/chatCards'
import { todoCard } from '../chat/chatCards'
import { checksSection, hasOutput } from '../chat/turnChecks'
import type { ChecksState } from '../chat/turnState'
import type { PaneView } from '../derive'
import { clear, h, icon, iconButton } from '../dom'
import { openReviewInFiles } from '../files/filesActions'
import { ICONS } from '../icons'
import { planProgress } from '../../shared/planProgress'
import { fitSidePanelWidth, MAX_SIDE_PANEL_WIDTH, MIN_SIDE_PANEL_WIDTH, SIDE_PANEL_TABS, type SidePanelSettings, type SidePanelTab } from '../../shared/sidePanel'
import { setSessionsLayout } from '../sessionsLayout'
import { panelSource } from '../sidePanelSources'
import { folderOfPane, store, type AppState } from '../state'
import './sidePanel.css'

const KEY_STEP = 10
const KEY_STEP_BIG = 40

interface Reply {
  id: string
  el: HTMLElement
  files: number
}

function savePanel(change: Partial<SidePanelSettings>): void {
  const sidePanel = { ...store.state.settings.sidePanel, ...change }
  store.set((state) => ({ ...state, settings: { ...state.settings, sidePanel } }))
  void saveSettings({ sidePanel })
}

/** Changes, Plan and Checks beside the open session. Closes to a thin rail, remembers its width and tab. */
export class SidePanelComponent {
  readonly el = h('aside', { class: 'side-panel', 'aria-label': 'Session panel', hidden: true })
  private readonly handle = h('div', {
    class: 'side-panel-resize',
    role: 'separator',
    'aria-label': 'Resize session panel',
    'aria-orientation': 'vertical',
    'aria-valuemin': MIN_SIDE_PANEL_WIDTH,
    'aria-valuemax': MAX_SIDE_PANEL_WIDTH,
    tabindex: '0'
  })
  private readonly tabs = h('div', { class: 'side-panel-tabs', role: 'tablist', 'aria-label': 'Panel' })
  private readonly body = h('div', { class: 'side-panel-body', role: 'tabpanel' })
  private readonly rail = h('button', { class: 'side-panel-rail', type: 'button', 'aria-label': 'Show the session panel', title: 'Show the session panel', onClick: () => savePanel({ open: true }) }, icon(ICONS.chevronLeft))
  private readonly full = h('div', { class: 'side-panel-full' }, this.tabs, this.body)
  private dragWidth: number | null = null
  /** The width the last key press asked for, so quick presses add up before the panel re-renders. */
  private keyWidth: number | null = null
  private drag: { pointerId: number; x: number; width: number } | null = null
  private signature = ''
  private bodyKey = ''

  constructor(private readonly stage: () => HTMLElement) {
    this.el.append(this.handle, this.rail, this.full)
    this.handle.addEventListener('pointerdown', (event) => this.onDown(event))
    this.handle.addEventListener('pointermove', (event) => this.onMove(event))
    this.handle.addEventListener('pointerup', (event) => this.onUp(event))
    this.handle.addEventListener('pointercancel', (event) => this.onUp(event))
    this.handle.addEventListener('keydown', (event) => this.onKey(event))
    this.handle.addEventListener('blur', () => { this.keyWidth = null })
  }

  update(state: AppState, view: PaneView | null, shown: boolean): void {
    this.el.hidden = !shown || view === null
    if (this.el.hidden || !view) {
      this.signature = ''
      this.bodyKey = ''
      return
    }
    const settings = state.settings.sidePanel
    this.el.classList.toggle('closed', !settings.open)
    this.rail.hidden = settings.open
    this.full.hidden = !settings.open
    this.handle.hidden = !settings.open
    this.applyWidth(settings.open ? (this.dragWidth ?? settings.width) : null)
    if (!settings.open) return
    const source = panelSource(view.pane.id)
    const todos = source?.todos() ?? []
    const plan = planProgress(todos)
    const reply = source?.card() ?? null
    const files = reply?.files ?? view.info.changes?.files ?? 0
    const checks = source?.checks() ?? null
    const signature = JSON.stringify([settings.tab, view.pane.id, files, plan?.label ?? '', checks?.results.map((result) => result.status) ?? null])
    if (signature !== this.signature) {
      this.signature = signature
      this.drawTabs(settings.tab, files, plan?.label ?? '', checks !== null && !checks.done)
    }
    this.drawBody(settings.tab, view, todos, reply, checks)
  }

  private applyWidth(wanted: number | null): void {
    if (wanted === null) {
      this.el.style.width = ''
      return
    }
    const room = this.stage().clientWidth || window.innerWidth
    const width = fitSidePanelWidth(wanted, room)
    this.el.style.width = `${width}px`
    this.handle.setAttribute('aria-valuenow', String(width))
  }

  private drawTabs(active: SidePanelTab, files: number, plan: string, checking: boolean): void {
    const counts: Record<SidePanelTab, string> = { changes: files > 0 ? String(files) : '', plan: plan.replace(' of ', '/'), checks: checking ? 'running' : '' }
    clear(this.tabs)
    for (const tab of SIDE_PANEL_TABS) {
      const count = counts[tab.id]
      this.tabs.append(
        h(
          'button',
          { class: `side-panel-tab${tab.id === active ? ' selected' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(tab.id === active), 'data-panel-tab': tab.id, onClick: () => savePanel({ tab: tab.id }) },
          tab.label,
          count ? h('span', { class: 'side-panel-count' }, count) : null
        )
      )
    }
    this.tabs.append(
      h('span', { class: 'side-panel-spacer' }),
      h('button', { class: 'link-quiet side-panel-grid', type: 'button', onClick: () => setSessionsLayout('grid') }, 'Back to grid'),
      iconButton('Close the session panel', ICONS.closeSmall, () => savePanel({ open: false }), 'small side-panel-close')
    )
  }

  private drawBody(tab: SidePanelTab, view: PaneView, todos: readonly TodoEntry[], reply: Reply | null, checks: ChecksState | null): void {
    const paneId = view.pane.id
    if (tab === 'changes' && reply) {
      if (this.body.firstElementChild !== reply.el) this.body.replaceChildren(reply.el)
      this.bodyKey = ''
      return
    }
    const detail = tab === 'changes' ? view.info.changes : tab === 'plan' ? todos : (checks?.results ?? null)
    const key = JSON.stringify([tab, paneId, detail])
    if (key === this.bodyKey && this.body.childElementCount > 0) return
    this.bodyKey = key
    if (tab === 'changes') this.body.replaceChildren(...this.changes(view, reply))
    else if (tab === 'plan') this.body.replaceChildren(...this.plan(todos))
    else this.body.replaceChildren(...this.checks(paneId, checks))
  }

  private changes(view: PaneView, reply: Reply | null): Node[] {
    if (reply) return [reply.el]
    const changes = view.info.changes
    const paneId = view.pane.id
    if (!changes || changes.files === 0) return [h('p', { class: 'side-panel-empty' }, 'No changes yet.'), h('p', { class: 'side-panel-hint' }, 'Files a reply changes show up here.')]
    return [
      h('p', { class: 'side-panel-line' }, `${changes.files} file${changes.files === 1 ? '' : 's'} changed in this session `, h('span', { class: 'add' }, `+${changes.added}`), ' ', h('span', { class: 'del' }, `−${changes.removed}`)),
      h(
        'div',
        { class: 'side-panel-actions' },
        h('button', { class: 'btn small', type: 'button', onClick: () => void openChanges(paneId) }, 'Review changes'),
        h('button', { class: 'btn small', type: 'button', onClick: () => this.openInFiles(view) }, 'Open in Files')
      )
    ]
  }

  private openInFiles(view: PaneView): void {
    const folder = folderOfPane(store.state, view.pane)
    if (folder) openReviewInFiles({ projectId: view.pane.projectId, folder })
  }

  private plan(todos: readonly TodoEntry[]): Node[] {
    if (todos.length === 0) return [h('p', { class: 'side-panel-empty' }, 'No plan yet.'), h('p', { class: 'side-panel-hint' }, 'When the agent writes a to-do list, it shows up here.')]
    const progress = planProgress(todos)
    return [h('p', { class: 'side-panel-line' }, progress ? `${progress.label} done` : `All ${todos.length} done`), todoCard(todos)]
  }

  private checks(paneId: string, state: ChecksState | null): Node[] {
    const source = panelSource(paneId)
    const section = checksSection(state)
    const nodes: Node[] = section
      ? [section]
      : [h('p', { class: 'side-panel-empty' }, 'No checks ran after the last reply.'), h('p', { class: 'side-panel-hint' }, 'Pick the checks to run in the settings for this project.')]
    const actions = h('div', { class: 'side-panel-actions' })
    if (source?.card()) actions.append(h('button', { class: 'btn small', type: 'button', onClick: () => source.rerunChecks() }, 'Run again'))
    if (hasOutput(state) && state?.done) actions.append(h('button', { class: 'btn small', type: 'button', onClick: () => source?.showOutput() }, 'Show full output'))
    if (actions.childElementCount > 0) nodes.push(actions)
    return nodes
  }

  private onDown(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    this.drag = { pointerId: event.pointerId, x: event.clientX, width: this.el.getBoundingClientRect().width }
    this.handle.setPointerCapture(event.pointerId)
    this.handle.classList.add('dragging')
  }

  private onMove(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return
    this.dragWidth = this.drag.width + this.drag.x - event.clientX
    this.applyWidth(this.dragWidth)
  }

  private onUp(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return
    this.drag = null
    this.handle.classList.remove('dragging')
    if (this.handle.hasPointerCapture(event.pointerId)) this.handle.releasePointerCapture(event.pointerId)
    const width = Math.round(this.el.getBoundingClientRect().width)
    this.dragWidth = null
    savePanel({ width })
  }

  private onKey(event: KeyboardEvent): void {
    const now = this.keyWidth ?? this.el.getBoundingClientRect().width
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP
    let width = now
    if (event.key === 'ArrowLeft') width += step
    else if (event.key === 'ArrowRight') width -= step
    else if (event.key === 'Home') width = MIN_SIDE_PANEL_WIDTH
    else if (event.key === 'End') width = MAX_SIDE_PANEL_WIDTH
    else return
    event.preventDefault()
    event.stopPropagation()
    this.keyWidth = fitSidePanelWidth(width, this.stage().clientWidth || window.innerWidth)
    savePanel({ width: this.keyWidth })
  }
}
