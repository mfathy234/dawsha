/** The start of the change after (or before) the caret's line, or null when the caret is at the last (or first) one. Starts are line starts, in order. */
export function nextChangeStart(starts: readonly number[], lineStart: number, direction: 1 | -1): number | null {
  if (direction === 1) return starts.find((start) => start > lineStart) ?? null
  for (let index = starts.length - 1; index >= 0; index -= 1) if (starts[index] < lineStart) return starts[index]
  return null
}

/** The review key: the file after (or before) this one in the list, staying put at the ends. */
export function neighbourFile(paths: readonly string[], current: string | null, direction: 1 | -1): string | null {
  if (paths.length === 0) return null
  const at = current === null ? -1 : paths.indexOf(current)
  if (at < 0) return direction === 1 ? paths[0] : paths[paths.length - 1]
  return paths[at + direction] ?? null
}
