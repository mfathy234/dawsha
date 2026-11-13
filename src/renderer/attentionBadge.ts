import { api } from './api'

let last = 0
let lastIds = ''

export function syncAttentionBadge(count: number, waitingIds: string[]): void {
  const ids = JSON.stringify([...waitingIds].sort())
  if (count === last && ids === lastIds) return
  last = count
  lastIds = ids
  api.setAttentionBadge(count, waitingIds)
}
