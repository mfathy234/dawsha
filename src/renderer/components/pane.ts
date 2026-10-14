import {
  addTab,
  answerPermission,
  enableBridge,
  closeDetails,
  closePane,
  closeTerminal,
  focusPane,
  focusRelative,
  movePane,
  moveTab,
  openDetails,
  openPaneFolder,
  restartTab,
  restoreGrid,
  setActiveTab,
  togglePinned,
  showPaneDiff,
  openChanges,
  paneHasRepo,
  paneSolution,
  findInPane,
  toggleAgents,
  toggleDetails,
  toggleMaximize
} from '../actions'
import { derivePanes, type PaneView } from '../derive'
import { store } from '../state'
import { shortcutFor } from '../commands/registry'
import { clear, h, icon, iconButton, placeNearAnchor } from '../dom'
import { AGENTS, AGENT_NAMES, sessionLabel } from '../../shared/agents'
import { continueIn, continueLabel } from '../handoffActions'
import { exportTranscript } from '../transcriptActions'
import { saveSelectionAsSnippet } from '../snippetActions'
import { clearScrollback, copyCurrentPrompt, copyLastReply, paneTerminal } from '../terminalActions'
import type { TabAgent } from '../../shared/types'
import { describeSync, formatSync } from '../../shared/gitBranches'
import { AgentsDrawer } from './agentsDrawer'
import { openBranchMenu } from './gitMenu'
import { buildDetails } from './opsDetails'
import { paneInfoStrip } from './paneInfo'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { ensureTerminal } from '../terminals'
import { enableDrag } from '../drag'
import { canCompact, contextHintText, showContextHint } from '../../shared/contextWarning'
import { dismissContextHint, typeCompact } from '../contextActions'
import { dropFiles, hasFiles } from '../fileDrop'
import { sessionState, type SessionState } from '../../shared/sessionState'
import { permissionPromptText } from '../../shared/permissionPrompt'
import { formatAge } from '../../shared/statusLine'
import { statePill } from './stateIcon'

const RESUMED_CHIP_MS = 60_000
const PROMPT_TAIL_ROWS = 18

export class PaneComponent {
  readonly el: HTMLElement
  private readonly mark = h('span', { class: 'slot' })
  private readonly index = h('span', { class: 'pane-title' })
  private readonly projectName = h('span', { class: 'pane-project', hidden: true })
  private readonly pin = h('span', { class: 'pane-pin', title: 'Pinned pane', role: 'img', 'aria-label': 'Pinned pane', hidden: true })
  private readonly fresh = h('span', { class: 'pane-fresh' }, 'new session')
  private readonly resumed = h('span', { class: 'chip chip-resumed', hidden: true }, 'resumed')
  private readonly compareChip = h('span', { class: 'chip chip-compare', hidden: true })
  private readonly fromChip = h('span', { class: 'chip chip-from', hidden: true })
  private readonly branch = h('button', {
    class: 'chip chip-branch',
    type: 'button',
    hidden: true,
    title: 'Git actions',
    'aria-haspopup': 'menu',
    onClick: () => openBranchMenu(this.paneId, this.branch)
  })
  private readonly branchName = h('span', { class: 'chip-text' })
  private readonly branchSync = h('span', { class: 'chip-sync', hidden: true })
  private readonly stateHost = h('span', { class: 'pane-state' })
  private stateSignature = ''
  private readonly permission = h('div', { class: 'pane-permission', role: 'alert', hidden: true })
  private permissionSignature = ''
  private readonly tabAdd = h('span', { class: 'pane-tab-add-slot', hidden: true })
  private readonly info = h('div', { class: 'pane-info', hidden: true })
  private readonly foot = h('div', { class: 'pane-foot', hidden: true })
  private infoSignature = ''
  private readonly hint = h('div', { class: 'pane-hint', role: 'status', hidden: true })
  private hintSignature = ''
  private readonly drawer = new AgentsDrawer()
  private readonly details = h('aside', { class: 'pane-details', 'aria-label': 'Details', hidden: true })
  private detailsSignature = ''
  private actionsMenu: HTMLElement | null = null
  private readonly restart = h('button', { class: 'btn small pane-restart', type: 'button' }, 'Restart')
  private readonly maxButton = h('span', { class: 'slot pane-maximize-slot' })
  private readonly tabs = h('div', { class: 'tabs', role: 'tablist' })
  private readonly body = h('div', { class: 'pane-body' })
  private tabSignature = ''
  private menu: HTMLElement | null = null
  private current: PaneView | null = null
  private lastActiveTab = ''

  constructor(readonly paneId: string) {
    this.branch.append(icon(ICONS.branch), this.branchName, this.branchSync)
    this.pin.append(icon(ICONS.pin))
    const header = h(
      'div',
      { class: 'pane-header' },
      this.mark,
      this.pin,
      this.index,
      this.projectName,
      this.stateHost,
      this.fresh,
      this.resumed,
      this.compareChip,
      this.fromChip,
      this.restart,
      h('span', { class: 'spacer' }),
      this.tabAdd,
      iconButton('Open in VS Code', ICONS.code, () => void openPaneFolder(paneId, 'vscode'), 'pane-vscode'),
      iconButton('Move pane', ICONS.layout, () => this.toggleMove(), 'pane-move'),
      iconButton('Pane actions', ICONS.more, () => this.toggleActions(), 'pane-actions'),
      iconButton('Previous pane', ICONS.prev, () => focusRelative(-1), 'pane-prev'),
      iconButton('Next pane', ICONS.next, () => focusRelative(1), 'pane-next'),
      this.maxButton,
      iconButton('Close pane', ICONS.close, () => void closePane(paneId), 'close-pane')
    )
    header.addEventListener('dblclick', (event) => {
      if ((event.target as HTMLElement).closest('button')) return
      toggleMaximize(paneId)
    })
    enableDrag<HTMLElement>(header, {
      ignore: 'button, input, a',
      targetAt: (x, y) => this.paneTargetAt(x, y),
      mark: (target) => this.markDrop(target),
      drop: (target) => {
        const index = store.state.panes.findIndex((p) => p.id === target.dataset.paneId)
        if (index >= 0) movePane(paneId, index)
      }
    })
    this.restart.addEventListener('click', () => {
      const view = this.current
      if (view) void restartTab(paneId, view.tabs.find((t) => t.active)?.id ?? view.pane.activeTabId)
    })
    this.info.addEventListener('click', (event) => {
      if (!this.el.classList.contains('maximized') || (event.target as HTMLElement).closest('button')) return
      toggleDetails(paneId)
    })
    const work = h('div', { class: 'pane-work' }, this.tabs, this.body)
    const content = h('div', { class: 'pane-content' }, work, this.details)
    this.foot.append(this.info, this.branch)
    this.el = h('section', { class: 'pane', 'data-pane-id': paneId }, header, this.hint, this.drawer.el, content, this.permission, this.foot)
    this.watchFileDrops()
    this.el.addEventListener('pointerdown', () => focusPane(paneId, true), true)
  }

  update(view: PaneView, focused: boolean, maximized: boolean): void {
    this.current = view
    const title = view.title
    this.index.textContent = `${view.index + 1} · ${title}`
    this.updateMark(view.agent)
    const projectName = view.named ? (view.project?.name ?? '') : ''
    this.projectName.hidden = projectName === ''
    this.projectName.textContent = projectName
    this.fresh.hidden = view.named
    const chipAt = view.pane.tabs.find((t) => t.id === view.pane.activeTabId)?.resumeChipAt
    this.resumed.hidden = chipAt === undefined || Math.max(view.now, Date.now()) - chipAt >= RESUMED_CHIP_MS
    const origin = view.pane.tabs.find((t) => t.id === view.primaryTabId)?.from
    this.fromChip.hidden = !origin
    this.fromChip.textContent = origin ? `from ${AGENT_NAMES[origin]}` : ''
    const link = view.pane.compare
    this.compareChip.hidden = !link
    this.compareChip.textContent = link ? link.slot.toUpperCase() : ''
    this.compareChip.title = link ? `Side ${link.slot.toUpperCase()} of a comparison` : ''
    this.el.setAttribute('aria-label', `Task ${view.index + 1} ${title.toUpperCase()}${maximized ? ', maximized' : ''}`)
    this.el.classList.toggle('focused', focused)
    this.el.classList.toggle('maximized', maximized)
    this.pin.hidden = view.pane.pinned !== true
    this.el.classList.toggle('pinned', view.pane.pinned === true)
    this.branch.hidden = !view.branch
    this.branchName.replaceChildren(h('bdi', {}, view.branch ?? ''))
    this.branchName.title = view.branch ?? ''
    const sync = formatSync(view.sync)
    this.branchSync.hidden = sync === ''
    this.branchSync.textContent = sync
    this.branch.title = view.sync ? `Git actions. ${describeSync(view.sync)} of ${view.branch ?? 'the upstream'}` : 'Git actions'
    const state = sessionState({ status: view.status, attention: view.attention })
    this.updateState(view, state)
    this.updateInfo(view, maximized)
    this.foot.hidden = this.info.hidden && this.branch.hidden
    this.updateHint(view)
    this.updatePermission(view, state)
    this.drawer.update(view.opsLive ? view.snapshot : null, view.activity, view.agentsOpen, view.title.toUpperCase(), view.now, view.info.geminiTools)
    this.updateDetails(view, maximized)
    this.restart.hidden = !view.activeExited
    this.updateMaximizeButton(maximized)
    this.updateTabs(view)
    this.updateTerminals(view)
    if (focused && this.lastActiveTab && this.lastActiveTab !== view.pane.activeTabId) {
      ensureTerminal(view.pane.activeTabId, view.pane.fontSize).focus()
    }
    this.lastActiveTab = view.pane.activeTabId
  }

  private updateState(view: PaneView, state: SessionState): void {
    const age = view.info.ageMs !== null ? formatAge(view.info.ageMs) : ''
    const signature = `${state}|${age}`
    if (signature !== this.stateSignature) {
      this.stateSignature = signature
      this.stateHost.replaceChildren(statePill(state, age))
    }
    this.el.classList.toggle('attention', view.attention !== 'none')
    this.el.classList.toggle('needs-you', state === 'needs')
    this.el.dataset.attention = view.attention
    this.el.dataset.state = state
  }

  private updatePermission(view: PaneView, state: SessionState): void {
    const needs = state === 'needs'
    const command = needs && store.state.waiting[this.paneId] ? permissionPromptText(paneTerminal(this.paneId)?.tailText(PROMPT_TAIL_ROWS) ?? '') : ''
    const signature = needs ? JSON.stringify([view.agent, command]) : ''
    if (signature === this.permissionSignature) return
    this.permissionSignature = signature
    this.permission.hidden = !needs
    if (!needs) return this.permission.replaceChildren()
    const name = AGENT_NAMES[view.agent]
    const key = (label: string): HTMLElement => h('kbd', { class: 'pane-permission-key' }, label)
    this.permission.replaceChildren(
      h(
        'div',
        { class: 'pane-permission-text' },
        h('span', { class: 'pane-permission-title' }, `${name} is waiting for your answer`),
        command ? h('code', { class: 'pane-permission-command', title: command }, command) : null
      ),
      h(
        'button',
        { class: 'btn small primary', type: 'button', 'aria-label': `Allow ${name} to continue`, onClick: () => answerPermission(this.paneId, true) },
        'Allow',
        key('Enter')
      ),
      h(
        'button',
        { class: 'btn small', type: 'button', 'aria-label': `Deny ${name}`, onClick: () => answerPermission(this.paneId, false) },
        'Deny',
        key('Esc')
      )
    )
  }

  private updateInfo(view: PaneView, maximized: boolean): void {
    this.info.classList.toggle('clickable', maximized)
    const bridgeInstalled = store.state.bridge.installed
    const signature = JSON.stringify([view.info, view.title, view.now, bridgeInstalled])
    if (signature === this.infoSignature) return
    this.infoSignature = signature
    const items = paneInfoStrip(view.info, {
      title: view.title.toUpperCase(),
      now: view.now,
      onOpenChanges: () => void openChanges(this.paneId),
      bridgeInstalled,
      onEnableBridge: () => void enableBridge(),
      onToggleAgents: () => {
        const tabId = view.primaryTabId
        toggleAgents(tabId)
      }
    })
    this.info.hidden = items.length === 0
    this.info.replaceChildren(...items)
  }

  private updateHint(view: PaneView): void {
    const percent = view.info.contextPercent
    const tabId = view.primaryTabId
    const show = percent !== null && showContextHint(percent, store.state.contextDismissed[tabId])
    const signature = show ? JSON.stringify([Math.round(percent), tabId, view.agent]) : ''
    if (signature === this.hintSignature) return
    this.hintSignature = signature
    this.hint.hidden = !show
    if (!show) return this.hint.replaceChildren()
    const compact = canCompact(view.agent)
      ? h('button', { class: 'btn small', type: 'button', onClick: () => typeCompact(tabId) }, 'Compact')
      : null
    this.hint.replaceChildren(
      h('span', { class: 'pane-hint-text' }, contextHintText(percent)),
      h('span', { class: 'spacer' }),
      ...(compact ? [compact] : []),
      h('button', { class: 'btn small', type: 'button', onClick: () => dismissContextHint(tabId, percent) }, 'Dismiss')
    )
  }

  private watchFileDrops(): void {
    const clearMark = (): void => this.el.classList.remove('file-drop')
    this.el.addEventListener('dragover', (event) => {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      this.el.classList.add('file-drop')
    })
    this.el.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget || !this.el.contains(event.relatedTarget as Node)) clearMark()
    })
    this.el.addEventListener('drop', (event) => {
      clearMark()
      if (!event.dataTransfer || !hasFiles(event.dataTransfer)) return
      event.preventDefault()
      const view = this.current
      if (!view) return
      const host = (event.target as HTMLElement).closest<HTMLElement>('.term-host[data-term-id]')
      const tabId = host?.dataset.termId ?? view.pane.activeTabId
      const agent = view.pane.tabs.find((t) => t.id === tabId)?.agent
      dropFiles(event.dataTransfer, tabId, agent)
    })
  }

  private updateDetails(view: PaneView, maximized: boolean): void {
    const open = maximized && view.detailsOpen
    this.details.hidden = !open
    this.el.classList.toggle('with-details', open)
    if (!open) {
      this.detailsSignature = ''
      return
    }
    const children = buildDetails(view, view.now, () => closeDetails())
    const signature = children.map((c) => c.outerHTML).join('')
    if (signature === this.detailsSignature) return
    this.detailsSignature = signature
    this.details.replaceChildren(...children)
  }

  private toggleMove(): void {
    if (this.actionsMenu) return this.closeActions()
    const views = derivePanes(store.state)
    const items = views.map((view, i) => {
      const here = view.pane.id === this.paneId
      const label = `${i + 1} · ${view.title.toUpperCase()}${here ? '  (this pane)' : ''}`
      const button = h('button', {
        class: 'menu-item',
        type: 'button',
        role: 'menuitem',
        disabled: here,
        onClick: () => {
          this.closeActions()
          movePane(this.paneId, i)
        }
      }, label)
      return button
    })
    const hint = h('div', { class: 'popover-foot' }, navigator.platform.toLowerCase().includes('mac')
      ? 'Cmd+Shift+Option+← → moves the focused pane'
      : 'Ctrl+Shift+Alt+← → moves the focused pane')
    this.actionsMenu = h('div', { class: 'popover menu pane-actions-menu', role: 'menu', 'aria-label': 'Move pane to position' }, ...items, hint)
    this.actionsMenu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.closeActions()
    })
    this.el.append(this.actionsMenu)
    placeNearAnchor(this.actionsMenu, this.el.querySelector('.pane-move'))
    items.find((b) => !(b as HTMLButtonElement).disabled)?.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outsideActions, true), 0)
    document.addEventListener('keydown', this.escapeActions, true)
  }

  private toggleActions(): void {
    if (this.actionsMenu) return this.closeActions()
    const run = (action: () => unknown): void => {
      this.closeActions()
      void action()
    }
    const item = (text: string, action: () => unknown, svg?: string, commandId?: string): HTMLElement => {
      const shortcut = commandId ? shortcutFor(commandId) : undefined
      return h(
        'button',
        { class: 'menu-item menu-item-icon', type: 'button', role: 'menuitem', onClick: () => run(action) },
        h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, svg ? icon(svg) : null),
        h('span', { class: 'menu-label' }, text),
        shortcut ? h('kbd', { class: 'menu-kbd' }, shortcut) : null
      )
    }
    const first = item('Open in VS Code', () => openPaneFolder(this.paneId, 'vscode'), ICONS.code)
    const studioItem = item('Open in Visual Studio', () => openPaneFolder(this.paneId, 'visualstudio'), ICONS.solution)
    studioItem.setAttribute('disabled', '')
    studioItem.title = 'No .sln solution in this folder'
    void paneSolution(this.paneId).then((solution) => {
      if (!solution) return
      studioItem.removeAttribute('disabled')
      studioItem.title = solution
    })
    const changesItem = item('Changes…', () => openChanges(this.paneId), ICONS.commit, 'pane.changes')
    if (!paneHasRepo(this.paneId)) {
      changesItem.setAttribute('disabled', '')
      changesItem.title = 'This pane folder is not a git repository'
    }
    const snippetItem = item('Save selection as snippet', () => saveSelectionAsSnippet(this.paneId), ICONS.snippet, 'terminal.save-snippet')
    if (!paneTerminal(this.paneId)?.hasSelection()) {
      snippetItem.setAttribute('disabled', '')
      snippetItem.title = 'Select some text in the terminal first'
    }
    const showDetails = item('Details', () => openDetails(this.paneId), ICONS.info)
    const pinned = this.current?.pane.pinned === true
    const pinItem = item(pinned ? 'Unpin pane' : 'Pin pane', () => togglePinned(this.paneId), ICONS.pin, 'pane.pin')
    const maximized = store.state.maximizedId === this.paneId
    const maximizeItem = item(
      maximized ? 'Restore pane to grid' : 'Expand pane',
      () => maximized ? restoreGrid() : toggleMaximize(this.paneId),
      maximized ? ICONS.restore : ICONS.maximize,
      'pane.maximize'
    )
    const source = this.current?.agent ?? 'shell'
    const handoffs =
      source === 'shell'
        ? []
        : AGENTS.filter((agent) => agent !== source).map((agent) => {
            const entry = item(continueLabel(agent), () => continueIn(this.paneId, agent))
            const mark = agentMark(agent)
            if (mark) entry.querySelector('.menu-icon')?.append(mark)
            return entry
          })
    this.actionsMenu = h(
      'div',
      { class: 'popover menu pane-actions-menu', role: 'menu', 'aria-label': 'Pane actions' },
      maximizeItem,
      first,
      studioItem,
      item('Open in Explorer', () => openPaneFolder(this.paneId, 'explorer'), ICONS.folder),
      item('Open terminal here', () => addTab(this.paneId, 'shell'), ICONS.terminal),
      item('Find…', () => findInPane(this.paneId), ICONS.search, 'pane.find'),
      item('Show diff', () => showPaneDiff(this.paneId), ICONS.diff),
      changesItem,
      item('Export transcript…', () => exportTranscript(this.paneId), ICONS.download),
      item('Copy last reply', () => copyLastReply(this.paneId), ICONS.copy, 'terminal.copy-reply'),
      item('Copy current prompt', () => copyCurrentPrompt(this.paneId), ICONS.copy, 'terminal.copy-prompt'),
      snippetItem,
      item('Clear scrollback', () => clearScrollback(this.paneId), ICONS.eraser),
      showDetails,
      pinItem,
      ...handoffs
    )
    this.actionsMenu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.closeActions()
    })
    this.el.append(this.actionsMenu)
    placeNearAnchor(this.actionsMenu, this.el.querySelector('.pane-actions'))
    first.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outsideActions, true), 0)
    document.addEventListener('keydown', this.escapeActions, true)
  }

  private readonly outsideActions = (event: Event): void => {
    const target = event.target as HTMLElement
    if (this.actionsMenu && !this.actionsMenu.contains(target) && !target.closest('.pane-actions')) this.closeActions()
  }

  private readonly escapeActions = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.actionsMenu) return
    event.stopPropagation()
    this.closeActions()
  }

  private closeActions(): void {
    document.removeEventListener('pointerdown', this.outsideActions, true)
    document.removeEventListener('keydown', this.escapeActions, true)
    this.actionsMenu?.remove()
    this.actionsMenu = null
  }

  private paneTargetAt(x: number, y: number): HTMLElement | null {
    if (document.querySelector('.grid.maximized')) return null
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.pane[data-pane-id]')
    return hit && hit !== this.el ? hit : null
  }

  private markDrop(target: HTMLElement | null): void {
    for (const marked of document.querySelectorAll('.pane.drop-target')) marked.classList.remove('drop-target')
    target?.classList.add('drop-target')
  }

  private tabTargetAt(x: number, y: number, termId: string): HTMLElement | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.tab[data-tab-id]')
    return hit && hit.parentElement === this.tabs && hit.dataset.tabId !== termId ? hit : null
  }

  private markTabDrop(target: HTMLElement | null): void {
    for (const marked of this.tabs.querySelectorAll('.tab.drop-target')) marked.classList.remove('drop-target')
    target?.classList.add('drop-target')
  }

  private markAgent = ''

  private updateMark(agent: TabAgent): void {
    if (this.markAgent === agent) return
    this.markAgent = agent
    clear(this.mark)
    const mark = agentMark(agent)
    if (mark) this.mark.append(mark)
  }

  private updateMaximizeButton(maximized: boolean): void {
    const label = maximized ? 'Restore pane to grid' : 'Maximize pane'
    const existing = this.maxButton.firstElementChild
    if (existing?.getAttribute('aria-label') === label) return
    clear(this.maxButton)
    this.maxButton.append(
      iconButton(label, maximized ? ICONS.restore : ICONS.maximize, () => toggleMaximize(this.paneId), 'maximize')
    )
  }

  private updateTabs(view: PaneView): void {
    const single = view.tabs.length === 1
    this.tabs.hidden = single
    this.tabAdd.hidden = !single
    const signature = JSON.stringify([view.tabs, single])
    if (signature === this.tabSignature) return
    this.tabSignature = signature
    const headerAdd = iconButton(`New terminal in ${view.title.toUpperCase()}`, ICONS.plus, () => this.toggleMenu(headerAdd), 'pane-tab-add')
    headerAdd.setAttribute('aria-haspopup', 'menu')
    this.tabAdd.replaceChildren(headerAdd)
    this.closeMenu()
    this.tabs.setAttribute('aria-label', `Terminals in ${view.title.toUpperCase()}`)
    clear(this.tabs)
    for (const tab of view.tabs) this.tabs.append(this.buildTab(view, tab))
    const add = iconButton(
      `New terminal in ${view.title.toUpperCase()}`,
      ICONS.plus,
      () => this.toggleMenu(add),
      'tab-add'
    )
    add.setAttribute('aria-haspopup', 'menu')
    this.tabs.append(h('div', { class: 'tab-add-slot' }, add))
  }

  private buildTab(view: PaneView, tab: PaneView['tabs'][number]): HTMLElement {
    const label = h(
      'button',
      {
        class: 'tab-label',
        type: 'button',
        role: 'tab',
        'aria-selected': tab.active ? 'true' : 'false',
        onClick: () => setActiveTab(this.paneId, tab.id)
      },
      tab.label
    )
    label.title = `${sessionLabel(tab.agent)}: ${tab.label}`
    const wrapper = h(
      'div',
      { class: `tab${tab.active ? ' active' : ''}${tab.exited ? ' exited' : ''}`, 'data-tab-id': tab.id },
      agentMark(tab.agent),
      label
    )
    enableDrag<HTMLElement>(wrapper, {
      ignore: '.tab-close',
      targetAt: (x, y) => this.tabTargetAt(x, y, tab.id),
      mark: (target) => this.markTabDrop(target),
      drop: (target) => {
        const index = view.tabs.findIndex((t) => t.id === target.dataset.tabId)
        if (index >= 0) moveTab(this.paneId, tab.id, index)
      }
    })
    if (tab.active) {
      wrapper.append(
        iconButton(`Close terminal ${tab.label}`, ICONS.closeSmall, () => void closeTerminal(this.paneId, tab.id), 'tab-close')
      )
    }
    return wrapper
  }

  private updateTerminals(view: PaneView): void {
    for (const tab of view.pane.tabs) {
      const terminal = ensureTerminal(tab.id, view.pane.fontSize)
      terminal.mount(this.body)
      terminal.setFontSize(view.pane.fontSize)
      terminal.setVisible(tab.id === view.pane.activeTabId)
    }
  }

  private toggleMenu(anchor: HTMLElement): void {
    if (this.menu) return this.closeMenu()
    const choose = (agent: TabAgent): void => {
      this.closeMenu()
      void addTab(this.paneId, agent)
    }
    const item = (text: string, agent: TabAgent): HTMLElement =>
      h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => choose(agent) }, agentMark(agent), text)
    const first = item('Claude session', 'claude')
    this.menu = h('div', { class: 'popover menu', role: 'menu' }, first, item('Codex session', 'codex'), item('Gemini session', 'gemini'), item('Shell', 'shell'))
    this.menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        this.closeMenu()
        anchor.focus()
      }
    })
    this.el.append(this.menu)
    placeNearAnchor(this.menu, anchor)
    first.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0)
  }

  private readonly outside = (event: Event): void => {
    if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu()
  }

  private closeMenu(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.menu?.remove()
    this.menu = null
  }

  dispose(): void {
    this.closeMenu()
    this.closeActions()
    this.el.remove()
  }
}
