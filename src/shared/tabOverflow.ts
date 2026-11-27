import type { SessionState } from './sessionState'

export interface TabSpan {
  id: string
  start: number
  end: number
}

/** Tabs that are not fully inside the visible span of the strip. */
export function tabsOutOfView(spans: readonly TabSpan[], viewStart: number, viewEnd: number, slack = 1): string[] {
  return spans.filter((span) => span.start < viewStart - slack || span.end > viewEnd + slack).map((span) => span.id)
}

/** The hidden-tabs menu: the ones that need you first, the rest in strip order. */
export function overflowOrder<T extends { state: SessionState }>(items: readonly T[]): T[] {
  return [...items.filter((item) => item.state === 'needs'), ...items.filter((item) => item.state !== 'needs')]
}

/** The "+N" label on the overflow button. */
export const overflowLabel = (count: number): string => `+${count}`
