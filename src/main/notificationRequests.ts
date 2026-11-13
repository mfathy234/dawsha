import type { NotificationActivation, NotificationAnswer, NotificationPermission } from '../shared/notificationAction'

const MAX_REQUESTS = 200
const EXPIRES_MS = 24 * 60 * 60 * 1000

/** Capabilities live only in this process: a notification left over after restart cannot approve anything. */
export class NotificationRequests {
  private readonly requests = new Map<string, { paneId: string; permission: NotificationPermission; at: number }>()

  add(paneId: string, requestId: string, permission: NotificationPermission, at = Date.now()): void {
    for (const [id, request] of this.requests) {
      if (request.paneId === paneId || at - request.at >= EXPIRES_MS) this.requests.delete(id)
    }
    this.requests.set(requestId, { paneId, permission: { ...permission }, at })
    if (this.requests.size > MAX_REQUESTS) this.requests.delete(this.requests.keys().next().value!)
  }

  take(activation: NotificationActivation, at = Date.now()): NotificationAnswer | undefined {
    const request = this.requests.get(activation.requestId)
    if (!request || request.paneId !== activation.paneId) return undefined
    this.requests.delete(activation.requestId)
    if (at - request.at >= EXPIRES_MS) return undefined
    return { ...request.permission, allow: activation.allow }
  }
}
