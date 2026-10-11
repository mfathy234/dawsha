import { compareVersions, isVersion } from './version'

export interface ChangelogSection {
  heading: string
  items: string[]
}

export interface ChangelogEntry {
  version: string
  date: string | null
  sections: ChangelogSection[]
}

const ENTRY_HEADING = /^##\s+\[([^\]]+)\](?:\s+-\s+(\S+))?\s*$/
const SECTION_HEADING = /^###\s+(.+?)\s*$/
const BULLET = /^[-*]\s+(.*)$/

export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let entry: ChangelogEntry | null = null
  let section: ChangelogSection | null = null
  let item: string | null = null
  const closeItem = (): void => {
    if (section && item !== null) section.items.push(item)
    item = null
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const entryMatch = ENTRY_HEADING.exec(rawLine)
    if (entryMatch) {
      closeItem()
      section = null
      const version = entryMatch[1].replace(/^v/, '')
      entry = isVersion(version) ? { version, date: entryMatch[2] ?? null, sections: [] } : null
      if (entry) entries.push(entry)
      continue
    }
    if (!entry) continue
    const sectionMatch = SECTION_HEADING.exec(rawLine)
    if (sectionMatch) {
      closeItem()
      section = { heading: sectionMatch[1], items: [] }
      entry.sections.push(section)
      continue
    }
    if (!section) continue
    const bullet = BULLET.exec(rawLine)
    if (bullet) {
      closeItem()
      item = bullet[1].trim()
    } else if (rawLine.trim() === '') {
      closeItem()
    } else if (item !== null && /^\s+/.test(rawLine)) {
      item = `${item} ${rawLine.trim()}`
    }
  }
  closeItem()
  return entries.sort((a, b) => {
    const dated = /^\d{4}-\d{2}-\d{2}$/
    if (a.date && b.date && dated.test(a.date) && dated.test(b.date) && a.date !== b.date) {
      return b.date.localeCompare(a.date)
    }
    return compareVersions(b.version, a.version)
  })
}

export function entryToMarkdown(entry: ChangelogEntry): string {
  return entry.sections
    .filter((section) => section.items.length > 0)
    .map((section) => `### ${section.heading}\n${section.items.map((item) => `- ${item}`).join('\n')}`)
    .join('\n\n')
}

export type WhatsNewDecision =
  | { show: false; record: string | null }
  | { show: true; from: string; entries: ChangelogEntry[] }

export const LEGACY_BASELINE_VERSION = '0.3.0'

export function effectiveLastSeen(lastSeen: string | null, hasExistingData: boolean): string | null {
  return lastSeen ?? (hasExistingData ? LEGACY_BASELINE_VERSION : null)
}

export function decideWhatsNew(current: string, lastSeen: string | null, entries: ChangelogEntry[]): WhatsNewDecision {
  if (!isVersion(current)) return { show: false, record: null }
  if (!lastSeen || !isVersion(lastSeen)) return { show: false, record: current }
  const order = compareVersions(current, lastSeen)
  if (order === 0) return { show: false, record: null }
  if (order < 0) return { show: false, record: current }
  const newer = entries.filter(
    (entry) => compareVersions(entry.version, lastSeen) > 0 && compareVersions(entry.version, current) <= 0
  )
  if (newer.length === 0) return { show: false, record: current }
  return { show: true, from: lastSeen, entries: newer }
}

export const entriesUpTo = (entries: ChangelogEntry[], current: string): ChangelogEntry[] =>
  entries.filter((entry) => compareVersions(entry.version, current) <= 0)
