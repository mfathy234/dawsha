/** Longest session title shown in a close dialog's heading and button. */
export const CLOSE_TITLE_MAX = 40

/** Shorter still on the confirm button, so Cancel and Close stay on one row. */
export const CLOSE_BUTTON_MAX = 24

/** Heading and button text for closing a working session called `title`; the caller writes the body. */
export function closeCopy(title: string): { title: string; confirmLabel: string } {
  return {
    title: `Close “${shortTitle(title)}”?`,
    confirmLabel: `Close “${shortTitle(title, CLOSE_BUTTON_MAX)}”`
  }
}

/** Only a session that is working right now asks before it closes; idle, done and exited ones close at once. */
export function confirmsClose(status: 'busy' | 'idle' | 'exited'): boolean {
  return status === 'busy'
}

/** A title cut to `max` characters on a word boundary where possible, ending with an ellipsis. */
export function shortTitle(title: string, max = CLOSE_TITLE_MAX): string {
  const flat = title.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  const head = space >= max / 2 ? cut.slice(0, space) : cut
  return `${head.replace(/[\s.,;:!?-]+$/, '')}…`
}
