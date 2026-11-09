import { api } from './api'
import { store } from './state'
import type { ProcessActivity } from '../shared/processActivity'
import { getTerminal } from './terminals'

const POLL_MS = 10_000

export function installProcessActivity(): void {
  let busy = false
  const refresh = async (): Promise<void> => {
    if (busy || document.visibilityState !== 'visible') return
    busy = true
    try {
      const visible = store.state.panes.flatMap((pane) => pane.tabs.filter((tab) => {
        if (tab.status !== 'running' || tab.view === 'chat' || pane.activeTabId !== tab.id) return false
        const element = getTerminal(tab.id)?.el
        return document.visibilityState === 'visible' && element?.classList.contains('active') && element.getBoundingClientRect().width > 0
      }).map((tab) => tab.id))
      const activity = await api.listProcessActivity(visible)
      const current = new Set(visible)
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
