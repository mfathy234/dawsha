import { pushRecent } from '../../shared/palette'

const STORAGE_KEY = 'dawsha.palette.recent'

export function loadRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function recordRecent(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pushRecent(loadRecents(), id)))
  } catch {
    return
  }
}
