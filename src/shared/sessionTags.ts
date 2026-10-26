export const SESSION_TAGS = ['bug', 'feature', 'review', 'research', 'docs'] as const

export type SessionTag = (typeof SESSION_TAGS)[number]

export const SESSION_TAG_LABELS: Record<SessionTag, string> = {
  bug: 'Bug',
  feature: 'Feature',
  review: 'Review',
  research: 'Research',
  docs: 'Docs'
}

export const isSessionTag = (value: unknown): value is SessionTag => typeof value === 'string' && (SESSION_TAGS as readonly string[]).includes(value)

export const SESSION_NAME_MAX = 160

/** A name typed by the user: trimmed, at most SESSION_NAME_MAX characters, and null when nothing is left (the edit is cancelled). */
export function cleanSessionName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, SESSION_NAME_MAX).trim()
  return name === '' ? null : name
}
