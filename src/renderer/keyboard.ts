import { isOverlayOpen } from './overlayOpen'
import { DEFAULT_FONT_SIZE } from '../shared/types'
import { DEFAULT_PALETTE_SHORTCUT } from '../shared/settingsSchema'
import { bind, formatShortcut, matchesBinding, parseShortcut, type KeyBinding, type KeyEventLike } from '../shared/shortcuts'
import { closeDetails, cycleActiveTab, openPalette, restoreGrid, setPaneFont, startSession, zoomPane } from './actions'
import { pickedAgent } from '../shared/quickPick'
import { commandForEvent } from './commands/registry'
import { paneById, store, type AppState } from './state'
import { api } from './api'
import { getTerminal } from './terminals'
import { closeTimeline } from './timelineActions'
import { closePeek } from './boardActions'
import { boardShowing } from './sessionsLayout'
import { contextMenuOpen } from './components/contextMenu'
import { requestFilesSearch } from './files/filesActions'
import { openGlobalSearch } from './components/globalSearch'
import { toggleShellDrawer } from './shellDrawer'
import { openShellHistory } from './shellUi'
import { terminalAgent } from './terminalSession'

const overlayOpen = isOverlayOpen

const ALTERNATE_PALETTE = bind('Ctrl+Shift+P')

function paletteBindings(state: AppState): KeyBinding[] {
  const configured = parseShortcut(state.settings.paletteShortcut) ?? bind(DEFAULT_PALETTE_SHORTCUT)
  return [configured, ALTERNATE_PALETTE]
}

export function isPaletteShortcut(event: KeyEventLike, state: AppState): boolean {
  return paletteBindings(state).some((binding) => matchesBinding(event, binding))
}

export function paletteShortcutLabel(state: AppState): string {
  return formatShortcut(paletteBindings(state)[0])
}

function zoomDelta(event: KeyboardEvent): number | 'reset' | null {
  if (event.key === '=' || event.key === '+' || event.code === 'NumpadAdd') return 1
  if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') return -1
  if (event.key === '0' || event.code === 'Numpad0') return 'reset'
  return null
}

// Esc inside a terminal always belongs to the agent: session status lags, so guessing "busy" made interrupts take two presses.
const inTerminal = (event: KeyboardEvent): boolean => (event.target as HTMLElement | null)?.closest('.xterm') != null

function escapeShouldRestore(event: KeyboardEvent): boolean {
  // Esc cancels a tab drag first, and never leaves the Side panel layout (that has its own Back to grid).
  if (document.body.classList.contains('dragging-ui') || store.state.settings.sessionsLayout === 'panel') return false
  return store.state.maximizedId !== null && !inTerminal(event)
}

/** Esc from inside the full-screen session (its pane or the session tabs) is for that session, not for the layout. */
function escapeBelongsToSession(event: KeyboardEvent): boolean {
  if (store.state.maximizedId === null || document.body.classList.contains('dragging-ui')) return false
  if (store.state.detailsPaneId !== null || store.state.timelinePaneId !== null) return false
  const target = event.target as HTMLElement | null
  return target?.closest('.pane, .pane-strip') != null
}

function peekShouldClose(event: KeyboardEvent): boolean {
  return !inTerminal(event)
}

function inTerminalOrField(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  return target?.closest('.xterm, input, textarea, select, [contenteditable="true"]') != null
}

function consume(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

const inFindBar = (event: KeyboardEvent): boolean => (event.target as HTMLElement | null)?.closest('.term-find, .timeline-search') != null

function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (contextMenuOpen() || (event.target as HTMLElement | null)?.closest?.('[role="menu"]:not(.leaving)')) return
  if (overlayOpen() || inFindBar(event)) return
  // Ctrl+Enter sends an edited message or saves a review comment, so it is not a shortcut while their box has focus.
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && (event.target as HTMLElement | null)?.closest?.('.chat-edit, .turn-cm')) return
  const state = store.state
  const hostId = (event.target as HTMLElement | null)?.closest<HTMLElement>('.term-host')?.dataset.termId
  if (hostId && terminalAgent(hostId) === 'shell' && (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'r') {
    consume(event)
    void openShellHistory(hostId)
    return
  }
  if (state.view === 'grid' && state.focusedId && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === '`' || event.code === 'Backquote')) {
    consume(event)
    toggleShellDrawer(state.focusedId)
    return
  }
  // State changes immediately; the picker mounts on the next animation frame. A fast Enter
  // in that gap still starts its default choice instead of reaching the old terminal.
  if (state.quickPickOpen && state.quickPickMode === 'new' && event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    consume(event)
    const project = state.settings.projects[0]
    if (project) void startSession(project.id, pickedAgent(project, {}, state.quickPickPreset))
    return
  }
  // Find in files: only while Files is showing, so Ctrl+Shift+F keeps searching the terminal everywhere else.
  if (state.view === 'files' && event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    consume(event)
    requestFilesSearch()
    return
  }
  // Search all sessions: Ctrl+Shift+F where nothing else claims it. Files searches files; a focused pane searches its terminal.
  if (state.view !== 'files' && !(state.view === 'grid' && paneById(state, state.focusedId)) && event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    consume(event)
    openGlobalSearch()
    return
  }
  if (isPaletteShortcut(event, state)) {
    consume(event)
    openPalette()
    return
  }
  const command = commandForEvent(event, state)
  if (command) {
    consume(event)
    void command.run()
    return
  }
  if (state.view !== 'grid') return
  if (boardShowing(state)) {
    if (event.key === 'Escape' && state.boardPeekId !== null && peekShouldClose(event)) {
      consume(event)
      closePeek()
    }
    return
  }
  // Ctrl+PageDown/PageUp switch a pane's terminal tabs from anywhere. Tab does it only outside the terminal and text
  // boxes: there Tab and Shift+Tab belong to the agent (Claude's mode switch, shell completion) or the field.
  const pageKey = (event.key === 'PageDown' || event.key === 'PageUp') && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
  const plainTab = event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && !inTerminalOrField(event)
  if ((pageKey || plainTab) && state.focusedId) {
    const focused = state.panes.find((pane) => pane.id === state.focusedId)
    if (focused && focused.tabs.length > 1) {
      consume(event)
      cycleActiveTab(pageKey ? (event.key === 'PageUp' ? -1 : 1) : event.shiftKey ? -1 : 1)
      return
    }
  }
  if (event.key === 'Escape' && escapeBelongsToSession(event)) {
    // Esc on the tab strip or the pane's own chrome means "stop the agent", never "leave full screen". Fields and the
    // chat box handle their own Esc, so only chrome forwards it to the session's terminal.
    if (!inTerminalOrField(event) && state.maximizedId) {
      consume(event)
      const pane = paneById(state, state.maximizedId)
      const view = pane ? getTerminal(pane.activeTabId) : undefined
      if (pane && view) {
        view.focus()
        api.write(pane.activeTabId, '\x1b')
      }
    }
    return
  }
  if (event.key === 'Escape' && escapeShouldRestore(event)) {
    consume(event)
    if (state.detailsPaneId !== null) closeDetails()
    else if (state.timelinePaneId !== null) closeTimeline()
    else restoreGrid()
    return
  }
  const mac = navigator.platform.toLowerCase().includes('mac')
  const ctrl = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  const zoom = ctrl && !event.altKey ? zoomDelta(event) : null
  if (zoom !== null && state.focusedId) {
    consume(event)
    if (zoom === 'reset') setPaneFont(state.focusedId, DEFAULT_FONT_SIZE)
    else zoomPane(state.focusedId, zoom)
  }
}

export function installKeyboard(): void {
  window.addEventListener('keydown', onKeyDown, true)
}
