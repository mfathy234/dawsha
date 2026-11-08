export const MAX_CHAT_HISTORY = 50

export function appendHistory(history: readonly string[], text: string): string[] {
  const value = text.trim()
  if (!value || history.at(-1) === value) return [...history]
  return [...history, value].slice(-MAX_CHAT_HISTORY)
}

export function historyAt(history: readonly string[], index: number, draft: string, direction: -1 | 1): { index: number; value: string } {
  if (direction < 0) {
    const next = index < 0 ? history.length - 1 : Math.max(0, index - 1)
    return { index: next, value: history[next] ?? draft }
  }
  if (index < 0) return { index: -1, value: draft }
  const next = index + 1
  return next >= history.length ? { index: -1, value: draft } : { index: next, value: history[next] }
}
