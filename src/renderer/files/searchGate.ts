/** Typing runs the same search only once, but pressing Enter always searches again because files may have changed. */
export function shouldSearch(lastKey: string, key: string, forced: boolean): boolean {
  return forced || key !== lastKey
}
