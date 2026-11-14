import { detectPermissionPrompt } from './permissionPrompt'

export const NOTIFICATION_SCHEME = 'dawsha-action'
export interface NotificationPermission { tabId: string; promptId: string }
export interface NotificationAnswer extends NotificationPermission { allow: boolean }
export interface NotificationActivation { paneId: string; requestId: string; allow: boolean }
export interface NotificationAction { content: string; arguments: string }

export function notificationActions(paneId: string, requestId: string): NotificationAction[] {
  return [true, false].map(allow => ({ content: allow ? 'Allow' : 'Deny',
    arguments: `${NOTIFICATION_SCHEME}:${allow ? 'allow' : 'deny'}?pane=${encodeURIComponent(paneId)}&request=${requestId}` }))
}

/** Strictly parse an untrusted external activation; the token is authorized separately in main. */
export function parseNotificationActivation(value: string): NotificationActivation | null {
  if (value.length > 1024) return null
  try {
    const url = new URL(value)
    if (url.protocol !== `${NOTIFICATION_SCHEME}:` || url.host || url.hash || !['allow', 'deny'].includes(url.pathname)) return null
    const keys = [...url.searchParams.keys()]
    if (keys.length !== 2 || !keys.includes('pane') || !keys.includes('request')) return null
    const paneId = url.searchParams.get('pane') ?? ''
    const requestId = url.searchParams.get('request') ?? ''
    if (!paneId || paneId.length > 200 || /[\u0000-\u001f\u007f]/.test(paneId) || !/^[a-f0-9]{32}$/.test(requestId)) return null
    return { paneId, requestId, allow: url.pathname === 'allow' }
  } catch { return null }
}

/** A replaced tab, changed screen or completed prompt can only be opened, never answered. */
export function canAnswerNotification(answer: NotificationAnswer, tabId: string | undefined, promptId: string | null): boolean {
  return answer.tabId === tabId && answer.promptId === promptId
}

/** Renderer-local identity for one uninterrupted prompt, comparing the whole screen tail. */
export class PermissionPromptTracker {
  private prompt: string | null = null
  private generation = 0
  constructor(private readonly instance: string) {}

  observe(tail: string): string | null {
    if (!detectPermissionPrompt(tail)) { this.invalidate(); return null }
    if (tail !== this.prompt) { this.prompt = tail; this.generation += 1 }
    return `${this.instance}:${this.generation}`
  }

  invalidate(): void { this.prompt = null; this.generation += 1 }
}
