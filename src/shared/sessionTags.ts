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

const BRANCH_PREFIX_TAGS: Record<string, SessionTag> = {
  feature: 'feature', feat: 'feature',
  fix: 'bug', bug: 'bug', bugfix: 'bug', hotfix: 'bug',
  docs: 'docs', doc: 'docs',
  review: 'review',
  research: 'research', spike: 'research'
}

// Words are fenced by "not a letter or digit" rather than the word-boundary escape, which does not see Arabic letters.
const word = (alternatives: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'iu')

const TEXT_RULES:[RegExp, SessionTag][] = [
  [word('fix|bug|error|crash|broken|fails?|failing|إصلاح|خطأ|مشكلة|عطل|تعطل'), 'bug'],
  [word('add|feature|implement|build|new|create|إضافة|أضف|ميزة|إنشاء|بناء'), 'feature'],
  [word('review|مراجعة|راجع'), 'review'],
  [word('docs?|readme|changelog|توثيق|وثائق'), 'docs']
]

const PLAIN_BRANCHES = new Set(['main', 'master', 'develop'])

/** A tag guessed from the branch prefix, else from the words of the title and first prompt; null when neither says. */
export function autoTag(branch: string | null, text: string): SessionTag | null {
  if (branch && !PLAIN_BRANCHES.has(branch.toLowerCase())) {
    const prefix = branch.split('/')[0].toLowerCase()
    const fromBranch = branch.includes('/') ? BRANCH_PREFIX_TAGS[prefix] : undefined
    if (fromBranch) return fromBranch
  }
  return TEXT_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

export type AutoTagSource = 'branch' | 'conversation'

/** Where autoTag(branch, text) took its tag from; null when it has none. */
export function autoTagSource(branch: string | null, text: string): AutoTagSource | null {
  if (autoTag(branch, '')) return 'branch'
  return autoTag(null, text) ? 'conversation' : null
}

export const SESSION_NAME_MAX = 160

/** A name typed by the user: trimmed, at most SESSION_NAME_MAX characters, and null when nothing is left (the edit is cancelled). */
export function cleanSessionName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, SESSION_NAME_MAX).trim()
  return name === '' ? null : name
}
