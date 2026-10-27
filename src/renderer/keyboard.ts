import { DEFAULT_FONT_SIZE } from '../shared/types'
import { DEFAULT_PALETTE_SHORTCUT } from '../shared/settingsSchema'
import { bind, formatShortcut, matchesBinding, parseShortcut, type KeyBinding, type KeyEventLike } from '../shared/shortcuts'
import { closeDetails, cycleActiveTab, openPalette, restoreGrid, setPaneFont, zoomPane } from './actions'
import { commandForEvent } from './commands/registry'
import { store, type AppState } from './state'
import { closeTimeline } from './timelineActions'
import { closePeek } from './boardActions'
import { boardShowing } from './sessionsLayout'
import { DICTATION_SHORTCUT } from '../shared/dictation'
import { cancelDictation, toggleDictation } from './dictation/dictationActions'
import { dictationStatus } from './dictation/dictationState'
import { contextMenuOpen } from './components/contextMenu'

const overlayOpen = (): boolean => document.querySelector('.overlay:not(.leaving), .popover:not(.leaving)') !== null

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
  return store.state.maximizedId !== null && !inTerminal(event)
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

const DICTATION_BINDING = bind(DICTATION_SHORTCUT)

// Dictation works from dialogs and text boxes too, so it is handled before the overlay guard.
function handleDictationKey(event: KeyboardEvent): boolean {
  if (matchesBinding(event, DICTATION_BINDING)) {
    consume(event)
    // Holding the keys repeats keydown; only the first press toggles.
    if (!event.repeat) void toggleDictation()
    return true
  }
  if (event.key === 'Escape' && dictationStatus().phase !== 'idle') {
    consume(event)
    cancelDictation()
    return true
  }
  return false
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (contextMenuOpen() || (event.target as HTMLElement | null)?.closest?.('[role="menu"]:not(.leaving)')) return
  if (handleDictationKey(event)) return
  if (overlayOpen() || inFindBar(event)) return
  const state = store.state
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
