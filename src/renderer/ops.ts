import { setOpsSnapshots } from './actions'
import { api } from './api'
import { trackedSessionIds } from './derive'
import { store } from './state'

const CLOCK_MS = 1000

function needsClock(): boolean {
  const state = store.state
  if (state.detailsPaneId !== null) return true
  if (state.panes.some((pane) => pane.tabs.some((tab) => tab.agentsOpen === true))) return true
  return state.view === 'grid' && state.panes.length > 0 && (
    Object.values(state.statusInfo).some((info) => info.rateLimits.length > 0) ||
    Object.values(state.opsInfo).some((info) => info.limits.length > 0)
  )
}

export async function installOps(): Promise<void> {
  let tracked = ''
  const sync = (): void => {
    const ids = trackedSessionIds(store.state)
    const signature = ids.join('|')
    if (signature === tracked) return
    tracked = signature
    api.trackOps(ids)
  }
  api.onOps(setOpsSnapshots)
  store.subscribe(sync)
  sync()
  setOpsSnapshots(await api.listOps())
  setInterval(() => {
    if (needsClock()) store.patch({ now: Date.now() })
  }, CLOCK_MS)
}
