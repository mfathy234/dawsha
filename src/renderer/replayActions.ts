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
    if (!found) {
      toast(store.state.settings.recordings.enabled ? 'There is no recording for this session yet.' : 'Recording is off. Turn on Record sessions in Settings to replay future sessions.', 'info')
      return
    }
    openReplay(found.id)
  } catch (error) {
    toast((error as Error).message || 'Could not open the recording.')
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
