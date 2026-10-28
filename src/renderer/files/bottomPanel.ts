import { PANEL_MIN_HEIGHT, clampPanelHeight } from '../../shared/filesLayout'
import { runTabLabel } from '../../shared/runStatus'
import type { RunSnapshot } from '../../shared/runCommands'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { RunCommandsPanel } from '../components/runCommandsPanel'
import { filesLayout, updateLayout } from './filesPrefs'

type Pane = 'run' | 'problems'

const GRIP_STEP = 24

/** The panel under the editor: a tab per run, a Problems tab, and minimise. Its height and whether it is minimised are remembered. */
export class BottomPanel {
  readonly el = h('section', { class: 'files-panel', id: 'files-panel', 'aria-label': 'Panel' })
  private pane: Pane = 'run'
  private runs: readonly RunSnapshot[] = []
  private selected = ''
  private readonly tabs = h('div', { class: 'files-panel-tabs', role: 'tablist', 'aria-label': 'Panel' })
  private readonly toggleButton = h('button', { class: 'icon-btn files-panel-toggle', type: 'button', id: 'files-run-toggle', 'aria-controls': 'files-panel-body', onClick: () => this.toggle() })
  private readonly body = h('div', { class: 'files-panel-body', id: 'files-panel-body' })
  private readonly problems = h('div', { class: 'files-problems', id: 'files-problems', role: 'tabpanel', hidden: true },
    h('p', { class: 'files-side-empty' }, 'No problems. Errors and warnings from builds and tests will list here when a run reports them.'))
  private readonly grip = h('div', { class: 'files-panel-grip', id: 'files-panel-grip', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize panel', tabindex: '0' })
  private height = filesLayout().panel.height
  private minimised = filesLayout().panel.minimised

  constructor(readonly run: RunCommandsPanel, private readonly changed: () => void) {
    run.el.id = 'files-run-panel'
    run.dismiss = () => {
      this.minimise()
      this.toggleButton.focus()
    }
    run.onRuns((runs, selected) => {
      this.runs = runs
      this.selected = selected
      this.renderTabs()
      changed()
    })
    this.body.append(run.el, this.problems)
    this.el.append(this.grip, h('div', { class: 'files-panel-head' }, this.tabs, this.toggleButton), this.body)
    this.grip.addEventListener('pointerdown', (event) => this.startDrag(event))
    this.grip.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      this.resize(this.height + (event.key === 'ArrowUp' ? GRIP_STEP : -GRIP_STEP))
    })
    this.tabs.addEventListener('keydown', (event) => this.onTabKey(event))
    this.apply()
  }

  get isMinimised(): boolean {
    return this.minimised
  }

  private available(): number {
    return this.el.parentElement?.clientHeight ?? 600
  }

  private resize(height: number): void {
    this.height = clampPanelHeight(height, this.available())
    updateLayout((layout) => ({ ...layout, panel: { ...layout.panel, height: this.height } }))
    this.apply()
  }

  private startDrag(event: PointerEvent): void {
    if (this.minimised) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = this.height
    const move = (next: PointerEvent): void => {
      this.height = clampPanelHeight(startHeight + (startY - next.clientY), this.available())
      this.apply()
    }
    const done = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', done)
      updateLayout((layout) => ({ ...layout, panel: { ...layout.panel, height: this.height } }))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', done)
  }

  expand(): void {
    if (!this.minimised) return
    this.minimised = false
    updateLayout((layout) => ({ ...layout, panel: { ...layout.panel, minimised: false } }))
    this.apply()
  }

  minimise(): void {
    if (this.minimised) return
    this.minimised = true
    updateLayout((layout) => ({ ...layout, panel: { ...layout.panel, minimised: true } }))
    this.apply()
  }

  toggle(): void {
    if (this.minimised) this.expand()
    else this.minimise()
  }

  private apply(): void {
    this.el.classList.toggle('minimised', this.minimised)
    this.body.hidden = this.minimised
    this.grip.hidden = this.minimised
    this.body.style.height = `${Math.max(this.height, PANEL_MIN_HEIGHT)}px`
    this.run.el.hidden = this.pane !== 'run'
    this.problems.hidden = this.pane !== 'problems'
    this.toggleButton.replaceChildren(icon(this.minimised ? ICONS.chevronUp : ICONS.chevronDown))
    const label = this.minimised ? 'Show panel' : 'Hide panel'
    this.toggleButton.setAttribute('aria-label', label)
    this.toggleButton.setAttribute('aria-expanded', String(!this.minimised))
    this.toggleButton.title = label
    this.grip.setAttribute('aria-valuenow', String(this.height))
    this.grip.setAttribute('aria-valuemin', String(PANEL_MIN_HEIGHT))
    this.changed()
  }

  show(pane: Pane): void {
    this.pane = pane
    this.expand()
    this.apply()
    this.renderTabs()
  }

  private tab(id: string, label: string, selected: boolean, onClick: () => void, extra: Record<string, string> = {}): HTMLElement {
    return h('button', { class: 'files-panel-tab', type: 'button', role: 'tab', id, 'aria-selected': String(selected), tabindex: selected ? '0' : '-1', onClick, ...extra }, label)
  }

  private renderTabs(): void {
    const folder = this.run.targetFolder
    const runTabs = this.runs.length === 0
      ? [this.tab('files-ptab-run', 'Run', this.pane === 'run', () => this.show('run'))]
      : this.runs.map((run) => this.tab(`files-ptab-${run.id}`, runTabLabel(run, folder), this.pane === 'run' && run.id === this.selected, () => {
        this.run.selectRun(run.id)
        this.show('run')
      }, { 'data-run': run.id, 'data-status': run.status, title: `${run.display}\n${run.status}` }))
    this.tabs.replaceChildren(...runTabs, this.tab('files-ptab-problems', 'Problems', this.pane === 'problems', () => this.show('problems')))
  }

  private onTabKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const tabs = [...this.tabs.querySelectorAll<HTMLElement>('[role="tab"]')]
    const at = tabs.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    next.click()
    this.tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
  }
}
