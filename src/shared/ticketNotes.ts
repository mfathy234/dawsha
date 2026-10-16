/** What the user added to a ticket on the Work dashboard: their own name for it and a link (for example to the issue). */
export interface TicketNote {
  name: string
  link: string
}

export type TicketNotes = Record<string, TicketNote>

const MAX_NOTES = 2000
const MAX_KEY = 400
const MAX_NAME = 120
const MAX_LINK = 2000

/** Only web links open from a ticket. */
export function isTicketLink(value: string): boolean {
  if (value.length === 0 || value.length > MAX_LINK) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** The link as typed, with https:// added when the user left it out ("dev.azure.com/..."). */
export function normalizeTicketLink(value: string): string {
  const link = value.trim()
  if (link === '') return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(link) ? link : `https://${link}`
}

/** Returns new notes with `note` for `key`; an empty name and link removes it. */
export function setTicketNote(notes: TicketNotes, key: string, note: TicketNote): TicketNotes {
  const name = note.name.trim().slice(0, MAX_NAME)
  const link = normalizeTicketLink(note.link)
  const { [key]: _old, ...rest } = notes
  if (name === '' && link === '') return rest
  if (link !== '' && !isTicketLink(link)) throw new Error('The link must be a web address (https://…).')
  return { ...rest, [key]: { name, link } }
}

export function sanitizeTicketNotes(value: unknown): TicketNotes {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const notes: TicketNotes = {}
  for (const [key, raw] of Object.entries(value).slice(0, MAX_NOTES)) {
    if (key.length === 0 || key.length > MAX_KEY || typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, MAX_NAME) : ''
    const link = typeof entry.link === 'string' && isTicketLink(entry.link) ? entry.link : ''
    if (name || link) notes[key] = { name, link }
  }
  return notes
}
