import { describe, expect, it } from 'vitest'
import type { TimelineEvent } from '../../src/shared/timeline'
import { matchedField, runTimelineSearch, searchSessionEvents, snippetParts } from '../../src/shared/timelineSearch'

const MIN = 60_000
const BASE = Date.UTC(2026, 9, 8, 9, 0, 0)
let n = 0
const ev = (minute: number, kind: TimelineEvent['kind'], extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: `e${n++}`,
  at: BASE + minute * MIN,
  kind,
  text: extra.text ?? kind,
  ...extra
})

const session = (): TimelineEvent[] => [
  ev(0, 'prompt', { text: 'Why is the zebracache step slow?' }),
  ev(1, 'reply', { text: 'The zebracache key is missing.' }),
  ev(2, 'edit', { path: 'ci/zebracache.yml', text: 'ci/zebracache.yml', added: 2, removed: 0 }),
  ev(3, 'command', { command: 'echo zebracache', text: 'echo zebracache' }),
  ev(4, 'test', { command: 'npm test', text: '3 passed', passed: 3, ok: true }),
  ev(5, 'error', { text: 'zebracache: cannot restore' })
]

describe('searchSessionEvents', () => {
  it('finds prompts, replies, paths, commands and errors, showing three and counting all', () => {
    const found = searchSessionEvents(session(), 'ZEBRACACHE', 'all')
    expect(found.total).toBe(5)
    expect(found.hits.map((hit) => hit.kind)).toEqual(['prompt', 'reply', 'edit'])
    expect(found.hits[0].snippet.some((part) => part.match && part.text === 'zebracache')).toBe(true)
  })

  it('narrows to the chosen kind', () => {
    expect(searchSessionEvents(session(), 'zebracache', 'edits').hits.map((hit) => hit.kind)).toEqual(['edit'])
    expect(searchSessionEvents(session(), 'zebracache', 'commands').total).toBe(1)
    expect(searchSessionEvents(session(), '3 passed', 'tests').total).toBe(1)
    expect(searchSessionEvents(session(), 'zebracache', 'tests').total).toBe(0)
  })

  it('has no hits for an empty or unknown query', () => {
    expect(searchSessionEvents(session(), '  ', 'all').total).toBe(0)
    expect(searchSessionEvents(session(), 'nothing here', 'all').total).toBe(0)
  })
})

describe('snippets', () => {
  it('cuts a window around the first match with ellipses and marks every match', () => {
    const text = `${'a '.repeat(60)}needle and needle ${'b '.repeat(60)}`
    const parts = snippetParts(text, 'needle', 20)
    const joined = parts.map((part) => part.text).join('')
    expect(joined.startsWith('…')).toBe(true)
    expect(joined.endsWith('…')).toBe(true)
    expect(parts.filter((part) => part.match)).toHaveLength(2)
  })

  it('shows the start of text that does not contain the query', () => {
    expect(snippetParts('short text', 'zzz')).toEqual([{ text: 'short text', match: false }])
  })

  it('names the field that matched', () => {
    const event = ev(0, 'read', { text: 'Read 2 files', paths: ['src/a.ts', 'src/needle.ts'] })
    expect(matchedField(event, 'needle')).toBe('src/needle.ts')
  })
})

describe('runTimelineSearch', () => {
  const sessions = ['new', 'old', 'older', 'oldest']
  const logs: Record<string, TimelineEvent[]> = {
    new: [ev(0, 'prompt', { text: 'nothing relevant' })],
    old: session(),
    older: [ev(0, 'prompt', { text: 'zebracache again' })],
    oldest: [ev(0, 'prompt', { text: 'zebracache one more' })]
  }
  const base = { sessions, load: async (name: string) => logs[name] ?? null, query: 'zebracache', filter: 'all' as const }

  it('groups matches by session in the order given and skips sessions without any', async () => {
    const out = await runTimelineSearch({ ...base, isCancelled: () => false })
    expect(out.groups.map((group) => group.session)).toEqual(['old', 'older', 'oldest'])
    expect(out.groups[0].total).toBe(5)
    expect(out.scanned).toBe(4)
    expect(out.more).toBe(false)
  })

  it('stops at the group limit and says there is more', async () => {
    const out = await runTimelineSearch({ ...base, isCancelled: () => false, maxGroups: 2 })
    expect(out.groups).toHaveLength(2)
    expect(out.more).toBe(true)
    expect(out.scanned).toBe(3)
  })

  it('stops reading as soon as it is cancelled', async () => {
    let loads = 0
    let cancelled = false
    const out = await runTimelineSearch({
      ...base,
      load: async (name: string) => {
        loads += 1
        if (loads === 2) cancelled = true
        return logs[name] ?? null
      },
      isCancelled: () => cancelled
    })
    expect(out.cancelled).toBe(true)
    expect(loads).toBe(2)
  })

  it('treats an unreadable session as having no matches', async () => {
    const out = await runTimelineSearch({
      ...base,
      load: async (name: string) => {
        if (name === 'old') throw new Error('unreadable')
        return logs[name] ?? null
      },
      isCancelled: () => false
    })
    expect(out.groups.map((group) => group.session)).toEqual(['older', 'oldest'])
  })

  it('does nothing for an empty query', async () => {
    const out = await runTimelineSearch({ ...base, query: ' ', isCancelled: () => false })
    expect(out).toEqual({ groups: [], scanned: 0, more: false, cancelled: false })
  })
})
