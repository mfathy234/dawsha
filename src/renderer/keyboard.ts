import { DEFAULT_FONT_SIZE } from '../shared/types'
import { DEFAULT_PALETTE_SHORTCUT } from '../shared/settingsSchema'
import { bind, formatShortcut, matchesBinding, parseShortcut, type KeyBinding, type KeyEventLike } from '../shared/shortcuts'
import { closeDetails, cycleActiveTab, openPalette, restoreGrid, setPaneFont, zoomPane } from './actions'
import { commandForEvent } from './commands/registry'
import { derivePanes } from './derive'
import { store, type AppState } from './state'
import { closeTimeline } from './timelineActions'

const overlayOpen = (): boolean => document.querySelector('.overlay, .popover') !== null

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

function escapeShouldRestore(event: KeyboardEvent): boolean {
  const { maximizedId, focusedId } = store.state
  if (!maximizedId) return false
  const inTerminal = (event.target as HTMLElement | null)?.closest('.xterm') !== null
  if (!inTerminal) return true
  const focused = derivePanes(store.state).find((v) => v.pane.id === focusedId)
  return focused?.status !== 'busy'
}

function consume(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

const inFindBar = (event: KeyboardEvent): boolean => (event.target as HTMLElement | null)?.closest('.term-find, .timeline-search') != null

function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing || overlayOpen() || inFindBar(event)) return
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
  if (event.key === 'Tab' && state.focusedId) {
    const focused = state.panes.find((pane) => pane.id === state.focusedId)
    if (focused && focused.tabs.length > 1) {
      consume(event)
      cycleActiveTab(event.shiftKey ? -1 : 1)
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
