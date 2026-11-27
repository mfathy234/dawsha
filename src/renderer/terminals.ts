import type { TabAgent } from '../shared/types'
import { textOrderFor } from '../shared/arabicRows'
import { api } from './api'
import { pasteText, shellKindOf } from '../shared/clipboard'
import { noteOutput } from './ptyActivity'
import { mapTerm, store } from './state'
import { currentBundle } from './themeManager'
import { fileLinkHost, highlightHost, watchHighlights } from './terminalExtras'
import { TerminalView } from './terminalView'
import { PendingTerminalOutput } from './pendingTerminalOutput'
import { blockCallbacks } from './terminalBlockHost'
import { oscHost, shellHost } from './terminalFeatures'
import { forgetTerminalSession, terminalAgent, terminalPane } from './terminalSession'
import { setTerminalProgress } from './terminalProgress'

export interface TerminalEvents {
  onZoom(termId: string, direction: 1 | -1): void
  onFocus(termId: string): void
}

const views = new Map<string, TerminalView>()
const pending = new PendingTerminalOutput()
let events: TerminalEvents = { onZoom: () => undefined, onFocus: () => undefined }

export const setTerminalEvents = (value: TerminalEvents): void => {
  events = value
}

function clearResumeChip(id: string): void {
  const pending = store.state.panes.some((p) => p.tabs.some((t) => t.id === id && t.resumeChipAt !== undefined))
  if (pending) store.set((s) => mapTerm(s, id, (t) => ({ ...t, resumeChipAt: undefined })))
}

function tabAgent(id: string): TabAgent | undefined {
  return terminalAgent(id)
}

const ESC = String.fromCharCode(27)
const FOCUS_IN = `${ESC}[I`
const FOCUS_OUT = `${ESC}[O`
const lastInput = new Map<string, string>()
const inputListeners = new Set<(id: string) => void>()

/** Hears every key or paste the owner (or a send from Dawsha) types into a terminal, except focus reports. */
export function onTerminalInput(listener: (id: string) => void): () => void {
  inputListeners.add(listener)
  return () => inputListeners.delete(listener)
}

export function ensureTerminal(id: string, fontSize: number): TerminalView {
  const existing = views.get(id)
  if (existing) return existing
  const view = new TerminalView(id, fontSize, currentBundle(), {
    osc: oscHost(id),
    shell: shellHost(id),
    onInput: (data) => {
      api.write(id, data)
      if (data !== FOCUS_IN && data !== FOCUS_OUT) {
        lastInput.set(id, data)
        for (const listener of inputListeners) listener(id)
      }
      if (data.charCodeAt(0) !== 27 || data.length === 1) clearResumeChip(id)
    },
    onResize: (cols, rows) => api.resize(id, cols, rows),
    onZoom: (direction) => events.onZoom(terminalPane(id)?.tabs.some((tab) => tab.id === id) ? id : terminalPane(id)?.activeTabId ?? id, direction),
    onFocus: () => events.onFocus(terminalPane(id)?.tabs.some((tab) => tab.id === id) ? id : terminalPane(id)?.activeTabId ?? id),
    readClipboard: async () => pasteText(await api.readClipboard(), tabAgent(id), shellKindOf(store.state.info.shellCommand)),
    writeClipboard: (text) => api.writeClipboard(text),
    openLink: (url) => void api.openExternal(url),
    fileLinks: fileLinkHost(id),
    highlights: highlightHost(id),
    textOrder: () => textOrderFor(tabAgent(id)),
    sleepingEnabled: () => store.state.settings.sleepHiddenTerminals,
    imagesEnabled: () => store.state.settings.showTerminalImages,
    ligaturesEnabled: () => store.state.settings.fontLigatures,
    blocks: blockCallbacks(id)
  })
  views.set(id, view)
  void api.getTerminalSetup(id).then((state) => showSetup(id, state)).catch(() => undefined)
  for (const chunk of pending.take(id)) view.write(chunk)
  return view
}

watchHighlights(() => views.values())
let lastImages = store.state.settings.showTerminalImages
let lastLigatures = store.state.settings.fontLigatures
store.subscribe((state) => {
  if (state.settings.showTerminalImages === lastImages && state.settings.fontLigatures === lastLigatures) return
  lastImages = state.settings.showTerminalImages
  lastLigatures = state.settings.fontLigatures
  for (const view of views.values()) view.refreshRendering()
})
setInterval(() => { for (const view of views.values()) view.refreshVisibility() }, 15_000)
document.addEventListener('visibilitychange', () => {
  for (const view of views.values()) view.refreshVisibility()
})

/** Worktree setup still in progress or failed, per terminal, so the pane header can say so instead of "Idle". */
const setupPhases = new Map<string, 'running' | 'failed'>()
export const setupPhaseOf = (id: string): 'running' | 'failed' | null => setupPhases.get(id) ?? null

function showSetup(id: string, state: { phase: 'running' | 'failed'; exitCode?: number } | null): void {
  if (state) setupPhases.set(id, state.phase)
  else setupPhases.delete(id)
  views.get(id)?.showSetupChoice(state?.phase === 'failed' ? (state.exitCode ?? -1) : null, (action) => void api.resolveTerminalSetup(id, action))
}

export const getTerminal = (id: string): TerminalView | undefined => views.get(id)

export function disposeTerminal(id: string): void {
  views.get(id)?.dispose()
  views.delete(id)
  pending.delete(id)
  setupPhases.delete(id)
  forgetTerminalSession(id)
  if (store.state.terminalProgress[id]) setTerminalProgress(id, null)
}

export function applyBundleToAll(): void {
  const bundle = currentBundle()
  for (const view of views.values()) view.applyBundle(bundle)
}

Object.defineProperty(window, '__grid', {
  value: {
    bufferText: (id: string): string => views.get(id)?.bufferText() ?? '',
    lineText: (id: string): string => views.get(id)?.lineText() ?? '',
    rawBufferText: (id: string): string => views.get(id)?.rawBufferText() ?? '',
    storeStats: (): { sets: number; flushes: number; listenerMs: number } => ({ ...store.stats }),
    viewportText: (id: string, above = 0): string => views.get(id)?.viewportText(above) ?? '',
    lastInput: (id: string): string => lastInput.get(id) ?? '',
    fontSize: (id: string): number => views.get(id)?.fontSize ?? 0,
    feed: (id: string, data: string): void => views.get(id)?.write(data),
    selectAll: (id: string): void => views.get(id)?.selectAll(),
    selectLine: (id: string, text: string): boolean => views.get(id)?.selectContaining(text) ?? false,
    viewportY: (id: string): number => views.get(id)?.prompts.viewportY ?? -1,
    promptMarkers: (id: string): number => views.get(id)?.prompts.count ?? 0
  }
})

export function connectPtyStreams(onExit: (id: string, exitCode: number) => void): void {
  api.onData((id, data) => {
    noteOutput(id)
    const view = views.get(id)
    if (view) view.write(data)
    else pending.append(id, data)
  })
  api.onTerminalSetup((id, state) => showSetup(id, state))
  api.onExit((id, exitCode) => {
    pending.delete(id)
    if (store.state.terminalProgress[id]) setTerminalProgress(id, null)
    onExit(id, exitCode)
  })
}
