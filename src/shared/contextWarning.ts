import type { TabAgent } from './types'

export const CONTEXT_AMBER = 80
export const CONTEXT_RED = 90

export type ContextLevel = 'ok' | 'amber' | 'red'

export function contextLevel(percent: number): ContextLevel {
  if (percent >= CONTEXT_RED) return 'red'
  if (percent >= CONTEXT_AMBER) return 'amber'
  return 'ok'
}

export const canCompact = (agent: TabAgent): boolean => agent === 'claude' || agent === 'codex'

export interface ContextNotice {
  notified: boolean
}

export function stepContextNotice(
  memory: ContextNotice,
  percent: number | null,
  unseen: boolean
): { memory: ContextNotice; notify: boolean } {
  if (percent === null || percent < CONTEXT_RED) return { memory: { notified: false }, notify: false }
  if (memory.notified) return { memory, notify: false }
  return { memory: { notified: true }, notify: unseen }
}
