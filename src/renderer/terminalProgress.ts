import type { TerminalProgress } from '../shared/terminalOsc'
import { api } from './api'
import { store, type PaneState } from './state'
import { terminalPane } from './terminalSession'

export const progressForPane = (pane: PaneState): TerminalProgress | null => {
  const entries = Object.entries(store.state.terminalProgress).filter(([id]) => terminalPane(id)?.id === pane.id)
  return entries.sort((a, b) => b[1].at - a[1].at)[0]?.[1].value ?? null
}

export function setTerminalProgress(id: string, value: TerminalProgress | null): void {
  store.set((state) => {
    const progress = { ...state.terminalProgress }
    if (!value || value.state === 0) delete progress[id]
    else progress[id] = { value, at: Date.now() }
    return { ...state, terminalProgress: progress }
  })
}

let last = ''
store.subscribe((state) => {
  const entries = Object.entries(state.terminalProgress).sort((a, b) => b[1].at - a[1].at)
  const active = entries.find(([id]) => terminalPane(id)?.id === state.focusedId) ?? entries[0]
  const value = active?.[1].value ?? null
  const signature = JSON.stringify(value)
  if (signature === last) return
  last = signature
  api.setTerminalProgress(value)
})
