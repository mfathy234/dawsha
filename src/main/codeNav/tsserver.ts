import type { server } from 'typescript'
import { normalize } from 'node:path'
import type { CodeNavKind, LanguageServerState } from '../../shared/codeNav'
import type { ServerLocation } from './locations'
import { Requests } from './requests'
import type { Wire } from './transport'

export interface QueryPosition { kind: CodeNavKind; line: number; column: number }
export interface NavigationClient {
  state: LanguageServerState
  ready: Promise<void>
  query(file: string, text: string, position: QueryPosition): Promise<ServerLocation[]>
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

  stop(): void { this.state = 'stopped'; this.requests.stop() }
}
