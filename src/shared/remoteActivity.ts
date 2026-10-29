export type RemoteActivityAction = 'paired' | 'approved' | 'denied' | 'message' | 'interrupt' | 'session-started' | 'session-stopped' | 'crew-run' | 'blocked'

export interface RemoteActivityEntry {
  id: string
  time: number
  device: string
  action: RemoteActivityAction
  session: string | null
  detail: string
}

export type RemoteActivityInput = Omit<RemoteActivityEntry, 'id' | 'time'>

export const MAX_REMOTE_ACTIVITY = 50
const COALESCE_MS = 10_000

export interface RemoteActivityLog {
  record(input: RemoteActivityInput): void
  list(limit?: number): RemoteActivityEntry[]
}

export function createActivityLog(now: () => number = Date.now, max = MAX_REMOTE_ACTIVITY): RemoteActivityLog {
  let entries: RemoteActivityEntry[] = []
  let counter = 0
  return {
    record(input) {
      const time = now()
      const latest = entries[0]
      if (latest && latest.device === input.device && latest.action === input.action && latest.session === input.session &&
          latest.detail === input.detail && time - latest.time < COALESCE_MS) return
      counter += 1
      entries = [{ ...input, id: String(counter), time }, ...entries].slice(0, max)
    },
    list(limit = max) {
      return entries.slice(0, Math.max(0, limit))
    }
  }
}

export function describeActivity(entry: RemoteActivityEntry): string {
  const where = entry.session ? ` in ${entry.session}` : ''
  switch (entry.action) {
    case 'paired': return `${entry.device} paired with this PC`
    case 'approved': return `${entry.device} allowed ${entry.detail}${where}`
    case 'denied': return `${entry.device} denied ${entry.detail}${where}`
    case 'message': return `${entry.device} sent a message${where}`
    case 'interrupt': return `${entry.device} interrupted a session${where}`
    case 'session-started': return `${entry.device} started a session${where}`
    case 'session-stopped': return `${entry.device} stopped a session${where}`
    case 'crew-run': return `${entry.device} ran ${entry.detail}${entry.session ? ` on ${entry.session}` : ''}`
    case 'blocked': return `${entry.device} was blocked from ${entry.detail}${where}`
  }
}
