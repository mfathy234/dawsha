import { api } from './api'
import { store } from './state'
import type { ProcessActivity } from '../shared/processActivity'

const POLL_MS = 5000

export function installProcessActivity(): void {
  let busy = false
  const refresh = async (): Promise<void> => {
    if (busy || document.visibilityState !== 'visible') return
    busy = true
    try {
      const activity = await api.listProcessActivity()
      const current = new Set(store.state.panes.flatMap((pane) => pane.tabs.filter((tab) => tab.status === 'running').map((tab) => tab.id)))
      const grouped: Record<string, ProcessActivity[]> = {}
      for (const item of activity) {
        if (!current.has(item.tabId)) continue
        ;(grouped[item.tabId] ??= []).push(item)
      }
      store.patch({ processActivity: grouped })
    } finally {
      busy = false
    }
  }
  setInterval(() => void refresh(), POLL_MS)
  document.addEventListener('visibilitychange', () => void refresh())
  void refresh()
}
