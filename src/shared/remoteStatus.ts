import type { RemoteAccessState } from './types'

export interface RemoteStatusCopy {
  kind: 'on' | 'dropped' | 'off' | 'busy'
  title: string
  detail: string
}

export function agoLabel(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'less than a minute ago'
  if (minutes === 1) return '1 minute ago'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`
}

export function deviceIsActive(lastSeenAt: number, now: number): boolean {
  return now - lastSeenAt < 60_000
}

export function lastSeenLabel(lastSeenAt: number, now: number): string {
  return deviceIsActive(lastSeenAt, now) ? 'Active now' : `Last seen ${agoLabel(now - lastSeenAt)}`
}

export function statusCopy(input: { status: RemoteAccessState['status']; droppedAt: number | null; message: string; now: number }): RemoteStatusCopy {
  switch (input.status) {
    case 'available':
      return { kind: 'on', title: 'Your phone can reach this PC', detail: 'Quick Tunnel, checked on its own every minute.' }
    case 'dropped':
      return {
        kind: 'dropped',
        title: `The tunnel dropped ${input.droppedAt === null ? 'a moment ago' : agoLabel(input.now - input.droppedAt)}`,
        detail: 'Your phone cannot reach this PC. Reconnecting gives a new link, so re-scan the code.'
      }
    case 'connecting':
      return { kind: 'busy', title: 'Opening the tunnel', detail: input.message }
    case 'reconnecting':
      return { kind: 'busy', title: 'Reconnecting the tunnel', detail: 'This gives a new link, so re-scan the code when it is ready.' }
    case 'setup-required':
      return { kind: 'off', title: 'Remote Access could not start', detail: input.message }
    default:
      return { kind: 'off', title: 'Remote Access is off', detail: 'Turn it on to answer your agents from your phone.' }
  }
}
