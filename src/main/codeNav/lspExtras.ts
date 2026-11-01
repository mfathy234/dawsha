import { fileURLToPath } from 'node:url'
import type { ServerCall, ServerFileEdits, ServerHover } from './protocolExtras'
import type { ServerLocation } from './locations'
import type { Requests } from './requests'

interface Position { line: number; character: number }
interface Range { start: Position; end: Position }
interface Item { uri: string; name: string; selectionRange: Range }
interface Edit { range: Range; newText: string }
const location = (uri: string, pos: Position): ServerLocation => {
  try { return { file: fileURLToPath(uri), line: pos.line + 1, column: pos.character + 1 } }
  catch { return { file: uri, line: pos.line + 1, column: pos.character + 1, outside: true } }
}

export function lspHover(raw: unknown): ServerHover {
  const contents = (raw as { contents?: unknown } | null)?.contents
  const values = Array.isArray(contents) ? contents : contents ? [contents] : []
  const display = values.filter(value => typeof value === 'object' && value !== null && 'language' in value).map(value => value.value).join('\n')
  const documentation = values.filter(value => !(typeof value === 'object' && value !== null && 'language' in value)).map(value => typeof value === 'string' ? value : value?.value ?? '').join('\n')
  return { display, documentation }
}

export function lspRename(raw: unknown): ServerFileEdits[] {
  if (!raw || typeof raw !== 'object') throw new Error('The language server did not return rename edits.')
  const workspace = raw as { changes?: Record<string, Edit[]>; documentChanges?: { textDocument?: { uri: string; version?: number | null }; edits?: Edit[] }[] }
  const changes = Object.entries(workspace.changes ?? {}).map(([uri, edits]) => ({ uri, edits }))
  for (const change of workspace.documentChanges ?? []) {
    if (!change.textDocument || !Array.isArray(change.edits)) throw new Error('Rename requires file operations that this editor cannot safely apply.')
    changes.push({ uri: change.textDocument.uri, edits: change.edits })
  }
  const byFile = new Map<string, ServerFileEdits>()
  for (const change of changes) {
    const file = fileURLToPath(change.uri)
    const edits = change.edits.map(edit => ({ line: edit.range.start.line + 1, column: edit.range.start.character + 1, endLine: edit.range.end.line + 1, endColumn: edit.range.end.character + 1, newText: edit.newText }))
    byFile.set(file, { file, edits: [...(byFile.get(file)?.edits ?? []), ...edits] })
  }
  return [...byFile.values()]
}

export async function lspCalls(requests: Requests, params: unknown, direction: 'incoming' | 'outgoing'): Promise<ServerCall[]> {
  const prepared = await requests.request('textDocument/prepareCallHierarchy', params) as Item[] | null
  const out: ServerCall[] = []
  for (const item of (prepared ?? []).slice(0, 100)) {
    const calls = await requests.request(`callHierarchy/${direction}Calls`, { item }) as { from?: Item; to?: Item; fromRanges: Range[] }[] | null
    for (const call of calls ?? []) {
      const target = call.from ?? call.to
      if (!target) continue
      out.push({ name: target.name, symbol: location(target.uri, target.selectionRange.start), calls: call.fromRanges.map(range => location(direction === 'incoming' ? target.uri : item.uri, range.start)) })
    }
  }
  return out
}
