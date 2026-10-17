export const RUN_TITLE_MAX = 60

/**
 * A short label for a run made from its story: the first sentence of the first line, cut at a word boundary with
 * an ellipsis when it is too long. Agents get the full story separately; this is only for lists and headers.
 */
export function runTitleFrom(story: string, max = RUN_TITLE_MAX): string {
  const line = story.trim().split(/\r?\n/)[0].replace(/\s+/g, ' ').trim()
  const sentence = line.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? line
  if (sentence.length <= max) return sentence
  const cut = sentence.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`
}
