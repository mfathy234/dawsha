import { api } from './api'
import { toast } from './components/toast'

const LEGACY_KEY = 'dawsha.limitWarned'

/** Hands the pre-1.8.9 warned windows to main once, then forgets them. */
async function migrateLegacy(): Promise<void> {
  let legacy: unknown = null
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    legacy = raw ? JSON.parse(raw) : null
  } catch { legacy = null }
  try {
    await api.migrateLimitWarned(legacy)
    localStorage.removeItem(LEGACY_KEY)
  } catch (error) { console.warn('Could not migrate the old usage warnings', error) }
}

/** Main finds the warnings; this shows the ones that belong in the app, with the same wording the toast always had. */
export function installLimitNotices(): void {
  api.onLimitWarning((message) => toast(message, 'info'))
  void migrateLegacy()
}
