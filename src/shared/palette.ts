export interface PaletteItem {
  id: string
  title: string
  group: string
  keywords?: string
  searchOnly?: boolean
}

export interface PaletteRow<T extends PaletteItem> {
  item: T
  indexes: number[]
}

export interface PaletteGroup<T extends PaletteItem> {
  label: string
  rows: PaletteRow<T>[]
}

export const GROUP_ORDER = ['Sessions', 'Closed sessions', 'Actions', 'Projects', 'Layouts'] as const
export const RECENT_GROUP = 'Recent'
export const RECENT_LIMIT = 6

interface Match {
  score: number
  indexes: number[]
}

const isWordStart = (text: string, index: number): boolean => index === 0 || /[\s\-_/.:'"([]/.test(text[index - 1])

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, offset) => start + offset)
}

function subsequence(token: string, lower: string): Match | null {
  const indexes: number[] = []
  let from = 0
  for (const char of token) {
    const found = lower.indexOf(char, from)
    if (found < 0) return null
    indexes.push(found)
    from = found + 1
  }
  let score = 400 - (indexes[indexes.length - 1] - indexes[0])
  for (const [position, index] of indexes.entries()) {
    if (position > 0 && index === indexes[position - 1] + 1) score += 8
    if (isWordStart(lower, index)) score += 12
  }
  return { score, indexes }
}

function matchToken(token: string, lower: string): Match | null {
  const at = lower.indexOf(token)
  if (at >= 0) {
    const start = isWordStart(lower, at) ? 200 : 0
    return { score: 1000 + start - at - (lower.length - token.length) * 0.1, indexes: range(at, token.length) }
  }
  return subsequence(token, lower)
}

export function fuzzyMatch(query: string, text: string): Match | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { score: 0, indexes: [] }
  const lower = text.toLowerCase()
  let score = 0
  const indexes = new Set<number>()
  for (const token of tokens) {
    const match = matchToken(token, lower)
    if (!match) return null
    score += match.score
    for (const index of match.indexes) indexes.add(index)
  }
  return { score, indexes: [...indexes].sort((a, b) => a - b) }
}

const KEYWORD_PENALTY = 300

function scoreItem(item: PaletteItem, query: string): Match | null {
  const title = fuzzyMatch(query, item.title)
  if (title) return title
  if (!item.keywords) return null
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const keywords = item.keywords.toLowerCase()
  return tokens.every((token) => keywords.includes(token)) ? { score: 1000 - KEYWORD_PENALTY, indexes: [] } : null
}

function groupRank(label: string): number {
  const rank = (GROUP_ORDER as readonly string[]).indexOf(label)
  return rank < 0 ? GROUP_ORDER.length : rank
}

function collect<T extends PaletteItem>(scored: { row: PaletteRow<T>; score: number }[]): PaletteGroup<T>[] {
  const groups = new Map<string, { row: PaletteRow<T>; score: number }[]>()
  for (const entry of scored) groups.set(entry.row.item.group, [...(groups.get(entry.row.item.group) ?? []), entry])
  return [...groups.entries()]
    .sort(([a], [b]) => groupRank(a) - groupRank(b))
    .map(([label, entries]) => ({
      label,
      rows: [...entries].sort((a, b) => b.score - a.score).map((entry) => entry.row)
    }))
}

export function buildGroups<T extends PaletteItem>(items: T[], query: string, recents: string[]): PaletteGroup<T>[] {
  if (query.trim() === '') return browseGroups(items, recents)
  const scored = items.flatMap((item) => {
    const match = scoreItem(item, query)
    return match ? [{ row: { item, indexes: match.indexes }, score: match.score }] : []
  })
  return collect(scored)
}

function browseGroups<T extends PaletteItem>(items: T[], recents: string[]): PaletteGroup<T>[] {
  const visible = items.filter((item) => !item.searchOnly)
  const byId = new Map(visible.map((item) => [item.id, item]))
  const recent = recents.flatMap((id) => (byId.has(id) ? [byId.get(id) as T] : [])).slice(0, RECENT_LIMIT)
  const taken = new Set(recent.map((item) => item.id))
  const rest = visible.filter((item) => !taken.has(item.id))
  const groups = [...rest.reduce((map, item) => map.set(item.group, [...(map.get(item.group) ?? []), item]), new Map<string, T[]>())]
  const ordered = groups
    .sort(([a], [b]) => groupRank(a) - groupRank(b))
    .map(([label, list]) => ({ label, rows: list.map((item) => ({ item, indexes: [] })) }))
  if (recent.length === 0) return ordered
  return [{ label: RECENT_GROUP, rows: recent.map((item) => ({ item, indexes: [] })) }, ...ordered]
}

export function flatten<T extends PaletteItem>(groups: PaletteGroup<T>[]): PaletteRow<T>[] {
  return groups.flatMap((group) => group.rows)
}

export function jumpGroup<T extends PaletteItem>(groups: PaletteGroup<T>[], selected: number, delta: 1 | -1): number {
  const starts: number[] = []
  let offset = 0
  for (const group of groups) {
    starts.push(offset)
    offset += group.rows.length
  }
  if (starts.length === 0) return 0
  const current = starts.filter((start) => start <= selected).length - 1
  const atStart = starts[current] === selected
  const target = delta === 1 ? current + 1 : atStart ? current - 1 : current
  return starts[(target + starts.length) % starts.length]
}

export function pushRecent(recents: string[], id: string, limit: number = RECENT_LIMIT * 2): string[] {
  return [id, ...recents.filter((existing) => existing !== id)].slice(0, limit)
}
