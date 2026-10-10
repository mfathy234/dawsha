export type UpdateMode = 'installed' | 'portable' | 'dev'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  mode: UpdateMode
  status: UpdateStatus
  currentVersion: string
  version: string | null
  releaseDate: string | null
  notes: string
  percent: number
  error: string | null
  checkedAt: number | null
  dismissed: boolean
}

export const initialUpdateState = (currentVersion = '0.0.0', mode: UpdateMode = 'dev'): UpdateState => ({
  mode,
  status: 'idle',
  currentVersion,
  version: null,
  releaseDate: null,
  notes: '',
  percent: 0,
  error: null,
  checkedAt: null,
  dismissed: false
})

export function detectUpdateMode(options: { packaged: boolean; portableDir: string | undefined; fake: boolean }): UpdateMode {
  if (options.portableDir) return 'portable'
  if (!options.packaged && !options.fake) return 'dev'
  return 'installed'
}

export function showUpdatePill(state: UpdateState): boolean {
  if (state.mode === 'dev') return false
  if (state.status === 'downloading' || state.status === 'error') return true
  if (state.status === 'available' || state.status === 'ready') return !state.dismissed
  return false
}

export function pillLabel(state: UpdateState): string {
  const version = state.version ?? ''
  if (state.status === 'downloading') return `Downloading ${version} ${Math.round(state.percent)}%`
  if (state.status === 'ready') return 'Restart to update'
  if (state.status === 'error') return 'Update failed'
  return `Update ${version}`
}

export function formatAgo(from: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - from) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function updateStatusLine(state: UpdateState, now: number): string {
  const version = `Dawsha ${state.currentVersion}`
  if (state.mode === 'dev') return `${version} · development build: updates are off`
  if (state.mode === 'portable') return `${version} · portable build: updates from GitHub`
  if (state.status === 'checking') return `${version} · checking for updates…`
  if (state.status === 'available') return `${version} · update available`
  if (state.status === 'downloading') return `${version} · downloading ${state.version ?? ''}`
  if (state.status === 'ready') return `${version} · update ready, restart to install`
  if (state.status === 'error') return `${version} · update failed`
  return state.checkedAt === null ? `${version} · not checked yet` : `${version} · up to date · checked ${formatAgo(state.checkedAt, now)}`
}
