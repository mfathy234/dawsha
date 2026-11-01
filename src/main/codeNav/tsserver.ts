import type { server } from 'typescript'
import { normalize } from 'node:path'
import type { CodeNavKind, LanguageServerState } from '../../shared/codeNav'
import type { ServerLocation } from './locations'
import { Requests } from './requests'
import type { Wire } from './transport'
import type { ExtrasPosition, ServerCall, ServerFileEdits, ServerHover } from './protocolExtras'

export interface QueryPosition { kind: CodeNavKind; line: number; column: number }
export interface NavigationClient {
  state: LanguageServerState
  ready: Promise<void>
  query(file: string, text: string, position: QueryPosition): Promise<ServerLocation[]>
  hover?(file: string, text: string, position: ExtrasPosition): Promise<ServerHover>
  rename?(file: string, text: string, position: ExtrasPosition, newName: string): Promise<ServerFileEdits[]>
  calls?(file: string, text: string, position: ExtrasPosition, direction: 'incoming' | 'outgoing'): Promise<ServerCall[]>
  stop(): void
}

export class TsServerClient implements NavigationClient {
  state: LanguageServerState = 'starting'
  readonly ready: Promise<void>
  private readonly requests: Requests
  private queue: Promise<unknown> = Promise.resolve()

  constructor(wire: Wire, timeout = 5000) {
    this.requests = new Requests(wire, 'ts', timeout)
    wire.onStop(() => { this.state = 'stopped' })
    this.ready = this.requests.request('configure', { preferences: { includePackageJsonAutoImports: 'off' } }).then(() => {
      if (this.state === 'starting') this.state = 'ready'
    }).catch(error => {
      this.stop()
      throw error
    })
    void this.ready.catch(() => undefined)
  }

  query(file: string, text: string, position: QueryPosition): Promise<ServerLocation[]> {
    const result = this.queue.then(() => this.runQuery(file, text, position))
    this.queue = result.catch(() => undefined)
    return result
  }

  private async runQuery(file: string, text: string, position: QueryPosition): Promise<ServerLocation[]> {
    try {
      await this.requests.request('updateOpen', { openFiles: [{ file, fileContent: text }] })
      const body = await this.requests.request(position.kind, { file, line: position.line, offset: position.column })
      const spans = position.kind === 'references' ? (body as server.protocol.ReferencesResponseBody | undefined)?.refs : body as server.protocol.FileSpan[] | undefined
      return (spans ?? []).map(span => ({ file: normalize(span.file), line: span.start.line, column: span.start.offset }))
    } finally {
      this.requests.notify('close', { file })
    }
  }

  private opened<T>(file: string, text: string, run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      try {
        await this.requests.request('updateOpen', { openFiles: [{ file, fileContent: text }] })
        return await run()
      } finally { this.requests.notify('close', { file }) }
    })
    this.queue = result.catch(() => undefined)
    return result
  }

  hover(file: string, text: string, position: ExtrasPosition): Promise<ServerHover> {
    return this.opened(file, text, async () => {
      const body = await this.requests.request('quickinfo', { file, line: position.line, offset: position.column }) as server.protocol.QuickInfoResponseBody | undefined
      const docs = body?.documentation
      return { display: body?.displayString ?? '', documentation: typeof docs === 'string' ? docs : (docs ?? []).map(part => part.text).join('') }
    })
  }

  rename(file: string, text: string, position: ExtrasPosition, newName: string): Promise<ServerFileEdits[]> {
    return this.opened(file, text, async () => {
      const body = await this.requests.request('rename', { file, line: position.line, offset: position.column, findInStrings: false, findInComments: false }) as server.protocol.RenameResponseBody
      if (!body?.info.canRename) throw new Error(body && 'localizedErrorMessage' in body.info ? body.info.localizedErrorMessage : 'This symbol cannot be renamed.')
      return body.locs.map(group => ({ file: normalize(group.file), edits: group.locs.map(span => ({ line: span.start.line, column: span.start.offset, endLine: span.end.line, endColumn: span.end.offset, newText: `${span.prefixText ?? ''}${newName}${span.suffixText ?? ''}` })) }))
    })
  }

  calls(file: string, text: string, position: ExtrasPosition, direction: 'incoming' | 'outgoing'): Promise<ServerCall[]> {
    return this.opened(file, text, async () => {
      const args = { file, line: position.line, offset: position.column }
      const prepared = await this.requests.request('prepareCallHierarchy', args) as server.protocol.CallHierarchyItem | server.protocol.CallHierarchyItem[] | undefined
      const items = Array.isArray(prepared) ? prepared : prepared ? [prepared] : []
      const out: ServerCall[] = []
      for (const item of items) {
        const at = { file: item.file, line: item.selectionSpan.start.line, offset: item.selectionSpan.start.offset }
        const calls = await this.requests.request(direction === 'incoming' ? 'provideCallHierarchyIncomingCalls' : 'provideCallHierarchyOutgoingCalls', at) as (server.protocol.CallHierarchyIncomingCall | server.protocol.CallHierarchyOutgoingCall)[]
        for (const call of calls ?? []) {
          const target = 'from' in call ? call.from : call.to
          out.push({ name: target.name, symbol: { file: normalize(target.file), line: target.selectionSpan.start.line, column: target.selectionSpan.start.offset }, calls: call.fromSpans.map(span => ({ file: normalize('from' in call ? target.file : item.file), line: span.start.line, column: span.start.offset })) })
        }
      }
      return out
    })
  }

  stop(): void { this.state = 'stopped'; this.requests.stop() }
}
