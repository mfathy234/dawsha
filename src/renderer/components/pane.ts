import {
  addTab,
  answerPermission,
  permissionTail,
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
  toggleDetails,
  toggleMaximize,
  makeLarge,
  canMakeLargePane,
  tagSession
} from '../actions'
import { derivePanes, type PaneView } from '../derive'
import { folderOfPane, paneById, store } from '../state'
import { openReviewInFiles } from '../files/filesActions'
import { shortcutFor } from '../commands/registry'
import { clear, h, icon, iconButton, placeNearAnchor, leave } from '../dom'
import { AGENTS, AGENT_NAMES, sessionLabel } from '../../shared/agents'
import { continueIn, continueLabel } from '../handoffActions'
import { exportTranscript } from '../transcriptActions'
import { replayPane, toggleRecordingPause } from '../replayActions'
import { api } from '../api'
import { clearScrollback, copyCurrentPrompt, copyLastReply, paneTerminal } from '../terminalActions'
import type { TabAgent } from '../../shared/types'
import { describeSync, formatSync } from '../../shared/gitBranches'
import { keycaps } from './keycaps'
import { tagMenuItems, tagWord, type TagSource } from './sessionTagUi'
import { SESSION_TAG_LABELS, type SessionTag } from '../../shared/sessionTags'
import { openPaneBranchMenu } from './gitMenu'
import { buildDetails } from './opsDetails'
import { paneInfoStrip } from './paneInfo'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { crewSignature, identityMark } from './crewAvatar'
import { ensureTerminal, getTerminal } from '../terminals'
import { enableDrag } from '../drag'
import { canCompact, contextHintText, showContextHint } from '../../shared/contextWarning'
import { dismissContextHint, typeCompact } from '../contextActions'
import { dropFiles, hasFiles } from '../fileDrop'
import { sessionState, type SessionState } from '../../shared/sessionState'
import { detectPermissionPrompt, parsePermissionDetail, permissionPromptText, type PermissionDetail, type PermissionOption } from '../../shared/permissionPrompt'
import { setStatePillSuffix, stateIcon, statePill } from './stateIcon'
import { timeInState } from '../stateClock'
import { toggleTimeline } from '../timelineActions'
import { recordState } from '../timelineLog'
import { TimelinePanel } from './timelinePanel'
import './paneCalm.css'
import './grid.css'
import { recapFromScreen } from '../../shared/recap'
import { PaneChat } from '../chat/paneChat'
import { ViewSwitch } from '../chat/viewSwitch'
import { chatHostFor, syncPaneChat } from '../chat/paneChatController'
import '../chat/chat.css'

const RESUMED_CHIP_MS = 60_000
const RECAP_REFRESH_MS = 2_500
const RECAP_SCREEN_ROWS = 60

/** The header's panel button: a slide-over over the terminal, without maximizing the pane. */
function toggleDetailsPanel(paneId: string): void {
  store.set((state) => ({ ...state, focusedId: paneId, detailsPaneId: state.detailsPaneId === paneId ? null : paneId }))
}

export class PaneComponent {
  readonly el: HTMLElement
  private readonly mark = h('span', { class: 'slot' })
  private readonly index = h('span', { class: 'pane-title' })
  private titleText = ''
  private readonly projectName = h('span', { class: 'pane-project', hidden: true })
  private readonly tagHost = h('span', { class: 'pane-tag', hidden: true })
  private tagShown = ''
  private readonly pin = h('span', { class: 'pane-pin', title: 'Pinned pane', role: 'img', 'aria-label': 'Pinned pane', hidden: true })
  private readonly fresh = h('span', { class: 'pane-fresh' }, 'new session')
  private readonly resumed = h('span', { class: 'chip chip-resumed', hidden: true }, 'resumed')
  private readonly compareChip = h('span', { class: 'chip chip-compare', hidden: true })
  private readonly fromChip = h('span', { class: 'chip chip-from', hidden: true })
  private readonly branch = h('button', {
    class: 'chip chip-branch',
    type: 'button',
    hidden: true,
    title: 'Switch branch or run a git action',
    'aria-haspopup': 'menu',
    onClick: () => openPaneBranchMenu(this.paneId, this.branch)
  })
  private readonly branchName = h('span', { class: 'chip-text' })
  private readonly branchSync = h('span', { class: 'chip-sync', hidden: true })
  private readonly stateHost = h('span', { class: 'pane-state' })
  private readonly viewSwitch = new ViewSwitch('Session view', 'pane-view')
  private chat!: PaneChat
  private chatShown = false
  private stateSignature = ''
  private readonly recap = h('div', { class: 'pane-recap', dir: 'auto', hidden: true })
  private recapText = ''
  private recapAt = 0
  private readonly permission = h('div', { class: 'pane-permission', role: 'alert', hidden: true })
  private permissionSignature = ''
  private permissionDetail: PermissionDetail | null = null
  private permissionPrompt = ''
  private readonly info = h('div', { class: 'pane-info', hidden: true })
  private readonly foot = h('div', { class: 'pane-foot', hidden: true })
  private infoSignature = ''
  private readonly hint = h('div', { class: 'pane-hint', role: 'status', hidden: true })
  private hintSignature = ''
  private readonly details = h('aside', { class: 'pane-details', 'aria-label': 'Details', hidden: true })
  private detailsSignature = ''
  private readonly timeline: TimelinePanel
  private actionsMenu: HTMLElement | null = null
  /** The header button whose menu is open: a second click on it closes the menu, the other one switches. */
  private actionsAnchor: HTMLElement | null = null
  private readonly restart = h('button', { class: 'btn small pane-restart', type: 'button' }, 'Restart')
  private readonly maxButton = h('span', { class: 'slot pane-maximize-slot' })
  private readonly closeButton = iconButton('Close pane', ICONS.close, () => void closePane(this.paneId), 'close-pane')
  private readonly tabs = h('div', { class: 'tabs', role: 'tablist' })
  private readonly body = h('div', { class: 'pane-body' })
  private tabSignature = ''
  private menu: HTMLElement | null = null
  private menuAnchor: HTMLElement | null = null
  private current: PaneView | null = null
  private lastActiveTab = ''

  constructor(readonly paneId: string) {
    this.branch.append(icon(ICONS.branch), this.branchName, this.branchSync)
    this.pin.append(icon(ICONS.pin))
    const header = h(
      'div',
      { class: 'pane-header' },
      this.mark,
      h('div', { class: 'pane-titles' }, this.index, this.projectName, this.fresh),
      this.pin,
      this.tagHost,
      this.resumed,
      this.compareChip,
      this.fromChip,
      this.stateHost,
      this.viewSwitch.el,
      this.restart,
      iconButton('Details panel', ICONS.info, () => toggleDetailsPanel(paneId), 'pane-panel'),
      this.maxButton,
      iconButton('Pane actions', ICONS.more, () => this.toggleActions(), 'pane-actions'),
      this.closeButton
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
    this.timeline = new TimelinePanel(paneId)
    const content = h('div', { class: 'pane-content' }, work, this.details, this.timeline.el)
    this.foot.append(this.info, this.branch)
    this.el = h('section', { class: 'pane', 'data-pane-id': paneId }, header, this.recap, this.hint, content, this.permission, this.foot)
    this.chat = new PaneChat(chatHostFor(paneId, () => this.current), this.permission)
    this.body.append(this.chat.el)
    this.watchFileDrops()
    // Header buttons (menu, details, maximize, close) act on this pane without making it the focused one,
    // which in Calm focus would also move it into the large slot.
    this.el.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('.pane-header button')) return
      focusPane(paneId, true)
    }, true)
    this.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || store.state.detailsPaneId !== paneId) return
      event.stopPropagation()
      closeDetails()
    })
  }

  update(view: PaneView, focused: boolean, maximized: boolean, quiet = false): void {
    this.current = view
    const title = view.title
    this.updateTitle(view.index + 1, title)
    this.updateMark(view)
    const projectName = view.named ? (view.project?.name ?? '') : ''
    this.projectName.hidden = false
    this.projectName.textContent = [projectName, AGENT_NAMES[view.agent]].filter((part) => part !== '').join(' · ')
    this.fresh.hidden = view.named
    this.updateTag(view.tag, view.tagAuto)
    this.index.title = [title, projectName, view.tag ? SESSION_TAG_LABELS[view.tag] : ''].filter((part) => part !== '').join(' · ')
    const chipAt = view.pane.tabs.find((t) => t.id === view.pane.activeTabId)?.resumeChipAt
    this.resumed.hidden = chipAt === undefined || Math.max(view.now, Date.now()) - chipAt >= RESUMED_CHIP_MS
    const origin = view.pane.tabs.find((t) => t.id === view.primaryTabId)?.from
    this.fromChip.hidden = !origin
    this.fromChip.replaceChildren(...(origin ? ['from ', agentMark(origin) ?? '', ` ${AGENT_NAMES[origin]}`] : []))
    const link = view.pane.compare
    this.compareChip.hidden = !link
    this.compareChip.textContent = link ? link.slot.toUpperCase() : ''
    this.compareChip.title = link ? `Side ${link.slot.toUpperCase()} of a comparison` : ''
    this.el.setAttribute('aria-label', `Task ${view.index + 1} ${title.toUpperCase()}${maximized ? ', maximized' : ''}`)
    this.el.classList.toggle('focused', focused)
    this.el.classList.toggle('calm', !focused && store.state.settings.dimOtherPanes)
    this.el.classList.toggle('quiet', quiet && !focused)
    this.el.classList.toggle('maximized', maximized)
    this.pin.hidden = view.pane.pinned !== true
    this.el.classList.toggle('pinned', view.pane.pinned === true)
    this.branch.hidden = !view.branch
    this.branchName.replaceChildren(h('bdi', {}, view.branch ?? ''))
    this.branchName.title = view.branch ?? ''
    const sync = formatSync(view.sync)
    this.branchSync.hidden = sync === ''
    this.branchSync.textContent = sync
    this.branch.title = view.sync ? `Switch branch or run a git action. ${describeSync(view.sync)} of ${view.branch ?? 'the upstream'}` : 'Switch branch or run a git action'
    const state = sessionState({ status: view.status, attention: view.attention })
    this.updateState(view, state)
    this.updateInfo(view, maximized)
    this.foot.hidden = this.info.hidden && this.branch.hidden
    this.updateRecap(view)
    this.recap.hidden = !store.state.settings.showRecap || this.recapText === ''
    this.updateHint(view)
    const asking = state === 'needs' || (this.chatShown && detectPermissionPrompt(permissionTail(this.paneId)))
    this.updatePermission(view, asking ? 'needs' : state)
    this.updateChat(view, state, asking)
    this.updateDetails(view, maximized)
    this.timeline.update(view, maximized && view.timelineOpen)
    this.el.classList.toggle('with-timeline', maximized && view.timelineOpen)
    this.restart.hidden = !view.activeExited
    this.updateMaximizeButton(maximized)
    this.updateTabs(view)
    this.updateTerminals(view)
    if (focused && this.lastActiveTab && this.lastActiveTab !== view.pane.activeTabId) {
      ensureTerminal(view.pane.activeTabId, view.pane.fontSize).focus()
    }
    this.lastActiveTab = view.pane.activeTabId
  }

  // The number prefix stays put; only the session name picks its own direction, so an Arabic title does not reorder '4 · '.
  private updateTitle(number: number, title: string): void {
    const signature = `${number}|${title}`
    if (signature === this.titleText) return
    this.titleText = signature
    this.index.replaceChildren(`${number} · `, h('bdi', { dir: 'auto' }, title))
  }

  private updateState(view: PaneView, state: SessionState): void {
    const inState = timeInState(this.paneId, state, view.now)
    if (state !== this.stateSignature) {
      // Rebuild only on a state change: replacing the icon restarts the Working spinner.
      this.stateSignature = state
      recordState(this.paneId, state, Date.now())
      this.stateHost.replaceChildren(statePill(state, inState))
    } else {
      setStatePillSuffix(this.stateHost, state, inState)
    }
    this.el.classList.toggle('attention', view.attention !== 'none')
    this.el.classList.toggle('needs-you', state === 'needs')
    this.el.dataset.attention = view.attention
    this.el.dataset.state = state
  }

  /** The approval card: what the agent wants to run or write, then Allow, Allow always (only when offered) and Deny. */
  private updatePermission(view: PaneView, state: SessionState): void {
    if (state !== 'needs') {
      if (this.permissionSignature === '') return
      this.permissionSignature = ''
      this.permissionDetail = null
      this.permissionPrompt = ''
      this.permission.hidden = true
      this.permission.replaceChildren()
      return
    }
    const tail = permissionTail(this.paneId)
    const detail = parsePermissionDetail(tail)
    const prompt = permissionPromptText(tail)
    if (detail.target !== '' || detail.options.length > 0) this.permissionDetail = detail
    if (prompt !== '') this.permissionPrompt = prompt
    const shown = this.permissionDetail ?? detail
    const project = view.project?.name ?? ''
    const signature = JSON.stringify([view.agent, project, shown, this.permissionPrompt])
    if (signature === this.permissionSignature) return
    this.permissionSignature = signature
    this.permission.hidden = false
    this.permission.replaceChildren(...this.approvalChildren(view, shown, this.permissionPrompt, project))
  }

  private updateChat(view: PaneView, state: SessionState, asking: boolean): void {
    const shown = syncPaneChat(this.paneId, view, state, asking, this.viewSwitch, this.chat)
    this.body.classList.toggle('chat-on', shown)
    if (!this.chat.holdsPermission && this.permission.parentElement !== this.el) this.el.insertBefore(this.permission, this.foot)
    if (shown !== this.chatShown) {
      this.chatShown = shown
      if (shown) this.chat.focusComposer()
      else getTerminal(view.primaryTabId)?.focus()
    }
  }

  private approvalChildren(view: PaneView, detail: PermissionDetail, prompt: string, project: string): HTMLElement[] {
    const name = AGENT_NAMES[view.agent]
    const always = detail.options.find((option) => option.kind === 'always')
    const subject = detail.target || prompt
    const key = (label: string): HTMLElement => h('kbd', { class: 'pane-permission-key' }, label)
    const head = h(
      'div',
      { class: 'pane-permission-head' },
      stateIcon('needs'),
      h('span', { class: 'pane-permission-title' }, `${name} is asking to proceed`),
      h('span', { class: 'chip pane-permission-tool' }, detail.tool)
    )
    const command = subject
      ? h(
          'code',
          { class: 'pane-permission-command', title: subject, dir: 'ltr' },
          detail.tool === 'Bash' ? h('span', { class: 'pane-permission-prompt', 'aria-hidden': 'true' }, '$ ') : null,
          subject
        )
      : null
    const where = project ? h('div', { class: 'pane-permission-meta' }, 'in ', h('span', { class: 'pane-permission-project' }, project)) : null
    const actions = h(
      'div',
      { class: 'pane-permission-actions' },
      h(
        'button',
        { class: 'btn small primary', type: 'button', 'aria-label': `Allow ${name} to continue`, onClick: () => answerPermission(this.paneId, true) },
        'Allow',
        key('Enter')
      ),
      always ? this.alwaysButton(name, always) : null,
      h(
        'button',
        { class: 'btn small ghost', type: 'button', 'aria-label': `Deny ${name}`, onClick: () => answerPermission(this.paneId, false) },
        'Deny',
        key('Esc')
      )
    )
    return [head, command, where, actions].filter((child): child is HTMLElement => child !== null)
  }

  private alwaysButton(name: string, option: PermissionOption): HTMLElement {
    return h(
      'button',
      {
        class: 'btn small',
        type: 'button',
        'aria-label': `Allow ${name} always`,
        title: option.label,
        onClick: () => answerPermission(this.paneId, option.number)
      },
      'Allow always'
    )
  }

  private reviewInFiles(): void {
    const pane = paneById(store.state, this.paneId)
    const folder = pane ? folderOfPane(store.state, pane) : null
    if (pane && folder) openReviewInFiles({ projectId: pane.projectId, folder })
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
      showLiveInfo: false,
      onEnableBridge: () => void enableBridge(),
      onReviewFiles: () => this.reviewInFiles()
    })
    // Session time alone is not worth a footer: it shows only next to model, changes, review or the others.
    this.info.hidden = !items.some((item) => !item.classList.contains('info-elapsed'))
    this.info.replaceChildren(...items)
  }

  // Read off the visible screen, so no file is read; at most once per RECAP_REFRESH_MS for each pane.
  private updateRecap(view: PaneView): void {
    if (!store.state.settings.showRecap) {
      this.recapAt = 0
      return
    }
    const now = Date.now()
    if (now - this.recapAt < RECAP_REFRESH_MS) return
    this.recapAt = now
    const text = recapFromScreen(getTerminal(view.primaryTabId)?.tailText(RECAP_SCREEN_ROWS) ?? '')
    if (text === this.recapText) return
    this.recapText = text
    this.recap.textContent = text
    this.recap.title = text
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
    const open = view.detailsOpen
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

  private updateTag(tag: SessionTag | null, source: TagSource): void {
    const shown = `${tag ?? ''}:${source ?? ''}`
    if (shown === this.tagShown) return
    this.tagShown = shown
    this.tagHost.hidden = tag === null
    this.tagHost.replaceChildren(...(tag ? [tagWord(tag, source)] : []))
  }

  /** Opened from Pane actions › Tag…, in the place of that button's menu. */
  private openTag(): void {
    if (this.actionsMenu) this.closeActions()
    this.actionsAnchor = this.el.querySelector<HTMLElement>('.pane-actions')
    const items = tagMenuItems(this.current?.tagAuto ? null : (this.current?.tag ?? null), (tag) => {
      this.closeActions()
      tagSession(this.paneId, tag)
    })
    this.actionsMenu = h('div', { class: 'popover menu pane-actions-menu', role: 'menu', 'aria-label': 'Tag session' }, ...items)
    this.el.append(this.actionsMenu)
    placeNearAnchor(this.actionsMenu, this.el.querySelector('.pane-actions'))
    items[0]?.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outsideActions, true), 0)
    document.addEventListener('keydown', this.escapeActions, true)
  }

  /** Opened from Pane actions › Move pane…, so it takes that button's place: clicking it again closes the menu. */
  private openMove(): void {
    if (this.actionsMenu) this.closeActions()
    this.actionsAnchor = this.el.querySelector<HTMLElement>('.pane-actions')
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
    placeNearAnchor(this.actionsMenu, this.el.querySelector('.pane-actions'))
    items.find((b) => !(b as HTMLButtonElement).disabled)?.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outsideActions, true), 0)
    document.addEventListener('keydown', this.escapeActions, true)
  }

  private toggleActions(): void {
    const anchor = this.el.querySelector<HTMLElement>('.pane-actions')
    const reopen = this.actionsAnchor !== anchor
    if (this.actionsMenu) this.closeActions()
    if (!reopen) return
    this.actionsAnchor = anchor
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
        shortcut ? keycaps(shortcut, 'menu-kbd') : null
      )
    }
    const first = item('Move pane…', () => this.openMove(), ICONS.layout)
    const changesItem = item('Changes…', () => openChanges(this.paneId), ICONS.commit, 'pane.changes')
    if (!paneHasRepo(this.paneId)) {
      changesItem.setAttribute('disabled', '')
      changesItem.title = 'This pane folder is not a git repository'
    }
    const pauseItem = item('Pause recording', () => toggleRecordingPause(this.paneId), ICONS.history)
    pauseItem.setAttribute('disabled', '')
    pauseItem.title = 'This terminal is not being recorded'
    const activeTab = this.current?.pane.activeTabId
    if (activeTab) {
      void api.setRecordingPaused(activeTab, null).then((paused) => {
        if (paused === null) return
        pauseItem.removeAttribute('disabled')
        pauseItem.title = ''
        const label = pauseItem.querySelector('.menu-label')
        if (label) label.textContent = paused ? 'Resume recording' : 'Pause recording'
      }, () => undefined)
    }
    const closeItem = item('Close pane', () => closePane(this.paneId), ICONS.close)
    closeItem.classList.add('danger')
    const liveInfo = this.current?.agent === 'claude' && !store.state.bridge.installed
      ? [item('Turn on live info', () => enableBridge(), ICONS.info)]
      : []
    const pinned = this.current?.pane.pinned === true
    const largeItems = canMakeLargePane(store.state, this.paneId)
      ? [item('Make large', () => makeLarge(this.paneId), ICONS.maximize, 'pane.make-large')]
      : []
    const pinItem = item(pinned ? 'Unpin pane' : 'Pin pane', () => togglePinned(this.paneId), ICONS.pin, 'pane.pin')
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
    const showDetails = item('Details', () => openDetails(this.paneId), ICONS.info)
    const restartItems = this.current?.activeExited
      ? [item('Restart', () => restartTab(this.paneId, this.current?.pane.activeTabId ?? ''), ICONS.refresh)]
      : []
    this.actionsMenu = h(
      'div',
      { class: 'popover menu pane-actions-menu', role: 'menu', 'aria-label': 'Pane actions' },
      h('div', { class: 'menu-heading', role: 'presentation' }, 'Pane'),
      first,
      ...largeItems,
      showDetails,
      pinItem,
      item('Tag…', () => this.openTag(), ICONS.tag),
      h('div', { class: 'menu-separator', role: 'separator' }),
      h('div', { class: 'menu-heading', role: 'presentation' }, 'Session'),
      item('New terminal', () => this.openTerminalPicker(), ICONS.plus),
      item('Find…', () => findInPane(this.paneId), ICONS.search, 'pane.find'),
      item('Replay session', () => replayPane(this.paneId), ICONS.replay, 'pane.replay'),
      item('Export transcript…', () => exportTranscript(this.paneId), ICONS.download),
      pauseItem,
      ...restartItems,
      h('div', { class: 'menu-separator', role: 'separator' }),
      h('div', { class: 'menu-heading', role: 'presentation' }, 'Open and review'),
      item('Show session timeline', () => toggleTimeline(this.paneId), ICONS.history, 'pane.timeline'),
      changesItem,
      ...liveInfo,
      h('div', { class: 'menu-separator', role: 'separator' }),
      closeItem
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
    if (this.actionsMenu && !this.actionsMenu.contains(target) && !this.actionsAnchor?.contains(target)) this.closeActions()
  }

  private readonly escapeActions = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.actionsMenu) return
    event.stopPropagation()
    this.closeActions()
  }

  private closeActions(): void {
    document.removeEventListener('pointerdown', this.outsideActions, true)
    document.removeEventListener('keydown', this.escapeActions, true)
    leave(this.actionsMenu)
    this.actionsAnchor?.focus()
    this.actionsMenu = null
    this.actionsAnchor = null
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

  private markKey = ''

  private updateMark(view: PaneView): void {
    const key = `${view.agent}|${crewSignature(view)}`
    if (this.markKey === key) return
    this.markKey = key
    clear(this.mark)
    const mark = identityMark(view, 24)
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
    const signature = JSON.stringify([view.tabs, single])
    if (signature === this.tabSignature) return
    this.tabSignature = signature
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
    const reopen = this.menuAnchor !== anchor
    if (this.menu) this.closeMenu()
    if (!reopen) return
    this.menuAnchor = anchor
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

  private openTerminalPicker(): void {
    const anchor = this.el.querySelector<HTMLElement>('.pane-actions')
    this.closeActions()
    if (anchor) this.toggleMenu(anchor)
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.menu && !this.menu.contains(target) && !this.menuAnchor?.contains(target)) this.closeMenu()
  }

  private closeMenu(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    leave(this.menu)
    this.menu = null
    this.menuAnchor = null
  }

  dispose(): void {
    this.closeMenu()
    this.closeActions()
    this.timeline.dispose()
    this.chat.dispose()
    this.el.remove()
  }
}
