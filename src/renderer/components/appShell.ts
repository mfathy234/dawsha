import { derivePanes } from '../derive'
import { h } from '../dom'
import type { AppState } from '../state'
import { store } from '../state'
import { saveSettings } from '../actions'
import { syncRecordingTitles } from '../replayActions'
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '../../shared/sidebarWidth'
import { AgentsViewComponent } from './agentsView'
import { BoardComponent } from './boardView'
import { GridComponent } from './grid'
import { ProjectsViewComponent } from './projectsView'
import { ReplayPickerComponent } from './replayPicker'
import { ReplayViewComponent } from './replayView'
import { LayoutsPopoverComponent } from './layoutsPopover'
import { OnboardingComponent } from './onboarding'
import { PaletteComponent } from './palette'
import { QuickPickComponent } from './quickpick'
import { ResumePickerComponent } from './resumePicker'
import { SettingsViewComponent } from './settingsView'
import { SkillsViewComponent } from './skillsView'
import { SidebarComponent } from './sidebar'
import { ThemePickerComponent } from './themePicker'
import { UpdatePopoverComponent } from './updatePopover'
import { WhatsNewComponent } from './whatsNew'
import { TopBarComponent } from './topbar'
import { UsageViewComponent } from './usageView'
import { OrchestratorViewComponent } from './orch/orchestratorView'
import { isSidebarCollapsed } from './sidebar'

export class AppShell {
  readonly el: HTMLElement
  private readonly topbar = new TopBarComponent()
  private readonly sidebar = new SidebarComponent()
  private readonly sidebarResize = h('div', {
    class: 'sidebar-resize-handle',
    role: 'separator',
    'aria-label': 'Resize project panel',
    'aria-orientation': 'vertical',
    'aria-valuemin': MIN_SIDEBAR_WIDTH,
    'aria-valuemax': MAX_SIDEBAR_WIDTH,
    tabindex: '0'
  })
  private readonly grid = new GridComponent()
  private readonly board = new BoardComponent()
  private readonly projects = new ProjectsViewComponent()
  private readonly agents = new AgentsViewComponent()
  private readonly skills = new SkillsViewComponent()
  private readonly usage = new UsageViewComponent()
  private readonly orchestrator = new OrchestratorViewComponent()
  private readonly settings = new SettingsViewComponent()
  private readonly replay = new ReplayViewComponent()
  private readonly replayPicker = new ReplayPickerComponent()
  private readonly quickPick = new QuickPickComponent(() => this.topbar.newSession)
  private readonly resumePicker = new ResumePickerComponent(() => this.topbar.newSession)
  private readonly onboarding = new OnboardingComponent()
  private readonly themePicker = new ThemePickerComponent(() => this.topbar.themeButton)
  private readonly updatePopover = new UpdatePopoverComponent(() => this.topbar.updatePill)
  private readonly whatsNew = new WhatsNewComponent()
  private readonly layoutsPopover = new LayoutsPopoverComponent(() => this.topbar.layoutsButton)
  private readonly palette = new PaletteComponent()
  private lastView: AppState['view'] = 'grid'
  private resizeStart: { pointerId: number; x: number; width: number } | null = null
  private resizeWidth = DEFAULT_SIDEBAR_WIDTH

  constructor() {
    const main = h('div', { class: 'main' }, this.grid.el, this.board.el, this.projects.el, this.agents.el, this.skills.el, this.usage.el, this.orchestrator.el, this.settings.el, this.replay.el)
    this.sidebarResize.addEventListener('pointerdown', this.onResizeStart)
    this.sidebarResize.addEventListener('pointermove', this.onResizeMove)
    this.sidebarResize.addEventListener('pointerup', this.onResizeEnd)
    this.sidebarResize.addEventListener('pointercancel', this.onResizeEnd)
    this.sidebarResize.addEventListener('keydown', this.onResizeKeyDown)
    this.el = h('div', { class: 'app' }, this.topbar.el, h('div', { class: 'body' }, this.sidebar.el, this.sidebarResize, main))
  }

  private setSidebarWidth(width: number): void {
    this.resizeWidth = clampSidebarWidth(width)
    this.el.style.setProperty('--sidebar-width', `${this.resizeWidth}px`)
    this.sidebarResize.setAttribute('aria-valuenow', String(this.resizeWidth))
  }

  private persistSidebarWidth(): void {
    const sidebarWidth = this.resizeWidth
    store.set((state) => ({ ...state, settings: { ...state.settings, sidebarWidth } }))
    void saveSettings({ sidebarWidth })
  }

  private readonly onResizeStart = (event: Event): void => {
    const pointer = event as PointerEvent
    if (pointer.button !== 0) return
    pointer.preventDefault()
    this.resizeStart = { pointerId: pointer.pointerId, x: pointer.clientX, width: this.sidebar.el.getBoundingClientRect().width }
    this.sidebarResize.setPointerCapture(pointer.pointerId)
    this.sidebarResize.classList.add('dragging')
  }

  private readonly onResizeMove = (event: Event): void => {
    const pointer = event as PointerEvent
    const start = this.resizeStart
    if (!start || start.pointerId !== pointer.pointerId) return
    this.setSidebarWidth(start.width + pointer.clientX - start.x)
  }

  private readonly onResizeEnd = (event: Event): void => {
    const pointer = event as PointerEvent
    if (!this.resizeStart || this.resizeStart.pointerId !== pointer.pointerId) return
    this.resizeStart = null
    this.sidebarResize.classList.remove('dragging')
    if (this.sidebarResize.hasPointerCapture(pointer.pointerId)) this.sidebarResize.releasePointerCapture(pointer.pointerId)
    this.persistSidebarWidth()
  }

  private readonly onResizeKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent
    let width = this.resizeWidth
    if (key.key === 'ArrowLeft') width -= key.shiftKey ? 40 : 10
    else if (key.key === 'ArrowRight') width += key.shiftKey ? 40 : 10
    else if (key.key === 'Home') width = MIN_SIDEBAR_WIDTH
    else if (key.key === 'End') width = MAX_SIDEBAR_WIDTH
    else return
    key.preventDefault()
    key.stopPropagation()
    this.setSidebarWidth(width)
    this.persistSidebarWidth()
  }

  render(state: AppState): void {
    const views = derivePanes(state)
    syncRecordingTitles(views)
    this.topbar.update(state, views)
    this.sidebar.update(state, views)
    this.setSidebarWidth(state.settings.sidebarWidth)
    this.sidebarResize.hidden = isSidebarCollapsed(state)
    const boardShown = state.view === 'grid' && state.settings.sessionsLayout === 'board'
    this.grid.el.hidden = state.view !== 'grid' || boardShown
    this.projects.el.hidden = state.view !== 'projects'
    if (state.view === 'projects' && this.lastView !== 'projects') this.projects.show(state)
    else if (state.view === 'projects') this.projects.update(state)
    this.agents.el.hidden = state.view !== 'agents'
    if (state.view === 'agents') this.agents.update(state)
    this.skills.el.hidden = state.view !== 'skills'
    if (state.view === 'skills' && this.lastView !== 'skills') this.skills.show()
    this.usage.el.hidden = state.view !== 'usage'
    this.usage.update(state)
    this.orchestrator.el.hidden = state.view !== 'orchestrator'
    if (state.view === 'orchestrator') this.orchestrator.update(state)
    this.settings.el.hidden = state.view !== 'settings'
    if (state.view === 'settings' && this.lastView !== 'settings') this.settings.show()
    else if (state.view === 'settings') this.settings.update(state)
    this.replay.update(state)
    this.lastView = state.view
    this.board.update(state, boardShown)
    this.grid.update(state)
    this.quickPick.update(state, views)
    this.resumePicker.update(state)
    this.onboarding.update(state)
    this.themePicker.update(state)
    this.updatePopover.update(state)
    this.whatsNew.update(state)
    this.layoutsPopover.update(state)
    this.palette.update(state)
    this.replayPicker.update(state)
  }
}
