/** How many lines a text has. A trailing newline ends the last line instead of starting another. */
export function lineCount(text: string | null): number {
  if (!text) return 0
  const lines = text.split('\n').length
  return text.endsWith('\n') ? lines - 1 : lines
}
