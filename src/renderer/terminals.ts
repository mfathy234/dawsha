import type { TabAgent } from '../shared/types'
import { api } from './api'
import { pasteText, shellKindOf } from '../shared/clipboard'
import { noteOutput } from './ptyActivity'
import { mapTerm, store } from './state'
import { currentBundle } from './themeManager'
import { fileLinkHost, highlightHost, watchHighlights } from './terminalExtras'
import { TerminalView } from './terminalView'
import { PendingTerminalOutput } from './pendingTerminalOutput'

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
  for (const pane of store.state.panes) {
    const tab = pane.tabs.find((t) => t.id === id)
    if (tab) return tab.agent
  }
  return undefined
}

const ESC = String.fromCharCode(27)
const FOCUS_IN = `${ESC}[I`
const FOCUS_OUT = `${ESC}[O`
const lastInput = new Map<string, string>()

export function ensureTerminal(id: string, fontSize: number): TerminalView {
  const existing = views.get(id)
  if (existing) return existing
  const view = new TerminalView(id, fontSize, currentBundle(), {
    onInput: (data) => {
      api.write(id, data)
      if (data !== FOCUS_IN && data !== FOCUS_OUT) lastInput.set(id, data)
      if (data.charCodeAt(0) !== 27 || data.length === 1) clearResumeChip(id)
    },
    onResize: (cols, rows) => api.resize(id, cols, rows),
    onZoom: (direction) => events.onZoom(id, direction),
    onFocus: () => events.onFocus(id),
    readClipboard: async () => pasteText(await api.readClipboard(), tabAgent(id), shellKindOf(store.state.info.shellCommand)),
    writeClipboard: (text) => api.writeClipboard(text),
    openLink: (url) => void api.openExternal(url),
    fileLinks: fileLinkHost(id),
    highlights: highlightHost()
  })
  views.set(id, view)
  for (const chunk of pending.take(id)) view.write(chunk)
  return view
}

watchHighlights(() => views.values())

export const getTerminal = (id: string): TerminalView | undefined => views.get(id)

export function disposeTerminal(id: string): void {
  views.get(id)?.dispose()
  views.delete(id)
  pending.delete(id)
}

export function applyBundleToAll(): void {
  const bundle = currentBundle()
  for (const view of views.values()) view.applyBundle(bundle)
}

Object.defineProperty(window, '__grid', {
  value: {
    bufferText: (id: string): string => views.get(id)?.bufferText() ?? '',
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
  api.onExit((id, exitCode) => {
    pending.delete(id)
    onExit(id, exitCode)
  })
}
