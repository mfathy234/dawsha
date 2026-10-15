import { api } from './api'
import { toast } from './components/toast'
import type { PaneView } from './derive'
import { paneById, store } from './state'

export function openReplayPicker(): void {
  store.patch({ replayPickerOpen: true, paletteOpen: false, quickPickOpen: false, themePickerOpen: false, updatePopoverOpen: false, layoutsOpen: false })
}

export function closeReplayPicker(): void {
  if (store.state.replayPickerOpen) store.patch({ replayPickerOpen: false })
}

export function openReplay(id: string): void {
  store.set((state) => ({
    ...state,
    replayPickerOpen: false,
    replay: { id, returnView: state.view === 'replay' ? (state.replay?.returnView ?? 'grid') : state.view },
    view: 'replay'
  }))
}

export function closeReplay(): void {
  store.set((state) => {
    if (state.view !== 'replay') return state
    return { ...state, view: state.replay?.returnView ?? 'grid', replay: null }
  })
}

export async function replayPane(paneId: string): Promise<void> {
  const pane = paneById(store.state, paneId)
  if (!pane) return
  try {
    const recordings = await api.listRecordings()
    const found = recordings.find((recording) => recording.terminalId === pane.activeTabId)
    if (found) {
      openReplay(found.id)
      return
    }
    if (store.state.settings.recordings.enabled) toast('There is no recording for this session yet.', 'info')
    else openReplayPicker()
  } catch (error) {
    toast((error as Error).message || 'Could not open the recording.')
  }
}

export async function toggleRecordingPause(paneId: string): Promise<void> {
  const pane = paneById(store.state, paneId)
  if (!pane) return
  try {
    const current = await api.setRecordingPaused(pane.activeTabId, null)
    if (current === null) {
      toast('This session is not being recorded.', 'info')
      return
    }
    const next = await api.setRecordingPaused(pane.activeTabId, !current)
    toast(next ? 'Recording paused for this terminal.' : 'Recording resumed.', 'info')
  } catch (error) {
    toast((error as Error).message || 'Could not change recording.')
  }
}

const sentTitles = new Map<string, string>()

export function syncRecordingTitles(views: PaneView[]): void {
  for (const view of views) {
    if (!view.named) continue
    for (const tab of view.pane.tabs) {
      if (tab.agent === 'shell' || sentTitles.get(tab.id) === view.title) continue
      sentTitles.set(tab.id, view.title)
      api.setRecordingTitle(tab.id, view.title)
    }
  }
}
