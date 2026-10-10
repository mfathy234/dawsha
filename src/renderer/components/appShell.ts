import { derivePanes } from '../derive'
import { h } from '../dom'
import type { AppState } from '../state'
import { AgentsViewComponent } from './agentsView'
import { GridComponent } from './grid'
import { ProjectsViewComponent } from './projectsView'
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

export class AppShell {
  readonly el: HTMLElement
  private readonly topbar = new TopBarComponent()
  private readonly sidebar = new SidebarComponent()
  private readonly grid = new GridComponent()
  private readonly projects = new ProjectsViewComponent()
  private readonly agents = new AgentsViewComponent()
  private readonly skills = new SkillsViewComponent()
  private readonly usage = new UsageViewComponent()
  private readonly settings = new SettingsViewComponent()
  private readonly quickPick = new QuickPickComponent(() => this.topbar.newSession)
  private readonly resumePicker = new ResumePickerComponent(() => this.topbar.newSession)
  private readonly onboarding = new OnboardingComponent()
  private readonly themePicker = new ThemePickerComponent(() => this.topbar.themeButton)
  private readonly updatePopover = new UpdatePopoverComponent(() => this.topbar.updatePill)
  private readonly whatsNew = new WhatsNewComponent()
  private readonly layoutsPopover = new LayoutsPopoverComponent(() => this.topbar.layoutsButton)
  private readonly palette = new PaletteComponent()
  private lastView: AppState['view'] = 'grid'

  constructor() {
    const main = h('div', { class: 'main' }, this.grid.el, this.projects.el, this.agents.el, this.skills.el, this.usage.el, this.settings.el)
    this.el = h('div', { class: 'app' }, this.topbar.el, h('div', { class: 'body' }, this.sidebar.el, main))
  }

  render(state: AppState): void {
    const views = derivePanes(state)
    this.topbar.update(state, views)
    this.sidebar.update(state, views)
    this.grid.el.hidden = state.view !== 'grid'
    this.projects.el.hidden = state.view !== 'projects'
    if (state.view === 'projects' && this.lastView !== 'projects') this.projects.show(state)
    else if (state.view === 'projects') this.projects.update(state)
    this.agents.el.hidden = state.view !== 'agents'
    if (state.view === 'agents') this.agents.update(state)
    this.skills.el.hidden = state.view !== 'skills'
    if (state.view === 'skills' && this.lastView !== 'skills') this.skills.show()
    this.usage.el.hidden = state.view !== 'usage'
    this.usage.update(state)
    this.settings.el.hidden = state.view !== 'settings'
    if (state.view === 'settings') this.settings.update(state)
    this.lastView = state.view
    this.grid.update(state)
    this.quickPick.update(state)
    this.resumePicker.update(state)
    this.onboarding.update(state)
    this.themePicker.update(state)
    this.updatePopover.update(state)
    this.whatsNew.update(state)
    this.layoutsPopover.update(state)
    this.palette.update(state)
  }
}
