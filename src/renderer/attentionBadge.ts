import { api } from './api'

let last = 0

export function syncAttentionBadge(count: number): void {
  if (count === last) return
  last = count
  api.setAttentionBadge(count)
}
