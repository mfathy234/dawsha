import type { ChatItem, ChatTool } from './chatLog'
import { formatDuration } from './chatTiming'

/** A run of quiet look-around tools shorter than this stays as plain rows. */
export const GROUP_MIN = 3

export interface ToolGroup {
  /** The id of the first tool, so the group keeps its identity while the run grows. */
  id: string
  tools: readonly ChatTool[]
  reads: number
  searches: number
  /** From the first tool to whatever came next; unknown when the log has no times. */
  ms: number | undefined
}

export type ThreadEntry = { type: 'item'; item: ChatItem } | { type: 'group'; group: ToolGroup }

export const groupKey = (id: string): string => `g:${id}`

/** A finished read or search with nothing to hide: no failure, no picture. Everything else stays in view. */
export function isQuietTool(item: ChatItem): item is ChatTool {
  if (item.kind !== 'tool') return false
  const looks = item.activity === 'read' || item.activity === 'search'
  return looks && item.done && !item.failed && !item.images?.length && !item.ask && !item.todos && !item.answers && !item.diff
}

function groupOf(tools: readonly ChatTool[], next: ChatItem | undefined): ToolGroup {
  const start = tools[0].at
  const end = next?.at ?? tools[tools.length - 1].at
  const ms = start !== undefined && end !== undefined && end - start >= 1000 ? end - start : undefined
  return {
    id: tools[0].id,
    tools,
    reads: tools.filter((tool) => tool.activity === 'read').length,
    searches: tools.filter((tool) => tool.activity === 'search').length,
    ms
  }
}

/** Turns the items into thread entries, folding runs of three or more quiet tools. `breaks` are indexes a run may not cross (a new day). */
export function groupTools(items: readonly ChatItem[], breaks: ReadonlySet<number> = new Set()): ThreadEntry[] {
  const entries: ThreadEntry[] = []
  let run: ChatTool[] = []
  const flush = (next: ChatItem | undefined): void => {
    if (run.length >= GROUP_MIN) entries.push({ type: 'group', group: groupOf(run, next) })
    else entries.push(...run.map((item): ThreadEntry => ({ type: 'item', item })))
    run = []
  }
  items.forEach((item, index) => {
    if (breaks.has(index)) flush(item)
    if (isQuietTool(item)) {
      run = [...run, item]
      return
    }
    flush(item)
    entries.push({ type: 'item', item })
  })
  flush(undefined)
  return entries
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** "Read 14 files, searched 6 times · 22s". */
export function groupLabel(group: Pick<ToolGroup, 'reads' | 'searches' | 'ms'>): string {
  const parts = [group.reads > 0 ? `Read ${plural(group.reads, 'file', 'files')}` : '', group.searches > 0 ? `searched ${plural(group.searches, 'time', 'times')}` : '']
  const text = parts.filter((part) => part !== '').join(', ')
  const label = text.charAt(0).toUpperCase() + text.slice(1)
  return group.ms !== undefined ? `${label} · ${formatDuration(group.ms)}` : label
}

/** Which group key each folded tool sits under, so a search can open the group that holds a match. */
export function groupMembership(entries: readonly ThreadEntry[]): ReadonlyMap<string, string> {
  return new Map(entries.flatMap((entry) => (entry.type === 'group' ? entry.group.tools.map((tool): [string, string] => [tool.id, groupKey(entry.group.id)]) : [])))
}
