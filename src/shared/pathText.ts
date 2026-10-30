/** A long path cut in the middle with an ellipsis, keeping its start and its end (the folder name) readable. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const keep = Math.max(3, max - 1)
  const head = Math.ceil(keep * 0.4)
  const tail = keep - head
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}
