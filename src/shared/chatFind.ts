import { foldLines, type ChatItem, type ChatNotice, type ChatTool } from './chatLog'

const lower = (text: string): string => text.toLocaleLowerCase()

/** Where each (non-overlapping) occurrence of the query starts, ignoring case. */
export function matchOffsets(text: string, query: string): number[] {
  const needle = lower(query)
  if (needle === '') return []
  const haystack = lower(text)
  const found: number[] = []
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) found.push(at)
  return found
}

/** The next index in a ring of `count`, or -1 when there is nothing to step through. */
export function wrapIndex(index: number, step: 1 | -1, count: number): number {
  if (count <= 0) return -1
  return (index + step + count) % count
}

const has = (text: string, query: string): boolean => lower(text).includes(lower(query))

function toolText(tool: ChatTool): { shown: string; folded: string } {
  const diff = tool.diff?.lines.map((line) => line.t).join('\n') ?? ''
  return { shown: `${tool.verb} ${tool.target} ${tool.note ?? ''}`, folded: [tool.command ?? '', tool.output, tool.plan ?? '', diff].join('\n') }
}

function toolKeys(tool: ChatTool, query: string, groupOf: ReadonlyMap<string, string>): string[] {
  const { shown, folded } = toolText(tool)
  const inRow = has(shown, query)
  const inside = has(folded, query)
  const group = groupOf.get(tool.id)
  return [...(group && (inRow || inside) ? [group] : []), ...(inside ? [`t:${tool.id}`] : [])]
}

function noticeKeys(notice: ChatNotice, query: string): string[] {
  return notice.detail && has(notice.detail, query) ? [`n:${notice.id}`] : []
}

function messageKeys(id: string, text: string, query: string): string[] {
  const folded = foldLines(text)
  if (folded.hidden === 0) return []
  return matchOffsets(text, query).some((at) => at >= folded.head.length) ? [`m:${id}`] : []
}

/**
 * The thread's fold keys that must be open for every match of the query to be on screen: the group a folded tool sits in,
 * the row's own output, the rest of a long message, a compaction's summary. Text that is already showing opens nothing.
 */
export function keysToOpen(items: readonly ChatItem[], query: string, groupOf: ReadonlyMap<string, string>): string[] {
  if (query.trim() === '') return []
  const keys = items.flatMap((item) => (item.kind === 'tool' ? toolKeys(item, query, groupOf) : item.kind === 'notice' ? noticeKeys(item, query) : messageKeys(item.id, item.text, query)))
  return [...new Set(keys)]
}
