export interface Starrable {
  starred?: boolean
}

export const isStarred = (item: Starrable): boolean => item.starred === true

/** The same list with starred items first; each group keeps its own order. */
export function starredFirst<T extends Starrable>(items: readonly T[]): T[] {
  return [...items.filter(isStarred), ...items.filter((item) => !isStarred(item))]
}

/** Where a drag may drop an item: starred items stay among the starred, the rest among the rest. */
export function clampMoveIndex(items: readonly Starrable[], from: number, to: number): number {
  const item = items[from]
  if (!item) return from
  const count = items.filter(isStarred).length
  const [low, high] = isStarred(item) ? [0, count - 1] : [count, items.length - 1]
  return Math.max(low, Math.min(high, to))
}

/** Pins or unpins one item: a newly pinned item joins the end of the pinned group, an unpinned one heads the rest. */
export function setStarred<T extends Starrable & { id: string }>(items: readonly T[], id: string, starred: boolean): T[] {
  const target = items.find((item) => item.id === id)
  if (!target || isStarred(target) === starred) return [...items]
  const changed = starred ? { ...target, starred: true } : { ...target, starred: undefined }
  const others = items.filter((item) => item.id !== id)
  const count = others.filter(isStarred).length
  return [...others.slice(0, count), changed, ...others.slice(count)]
}

/** What to keep from a saved list: only the starred flag, so older saves without it stay unpinned. */
export const savedStar = (value: unknown): true | undefined => (value === true ? true : undefined)
