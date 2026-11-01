import { fileURLToPath, pathToFileURL } from 'node:url'
import type { LanguageServerState } from '../../shared/codeNav'
import type { ServerLocation } from './locations'
import type { NavigationClient, QueryPosition } from './tsserver'
import { Requests } from './requests'
import type { Wire } from './transport'

interface Position { line: number; character: number }
interface Location { uri?: string; range?: { start: Position }; targetUri?: string; targetSelectionRange?: { start: Position }; targetRange?: { start: Position } }

function locations(raw: unknown): ServerLocation[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : []
  return values.flatMap((value: Location) => {
    const uri = value?.uri ?? value?.targetUri
    const start = (value?.range ?? value?.targetSelectionRange ?? value?.targetRange)?.start
    if (!uri || !start) return []
    try { return [{ file: fileURLToPath(uri), line: start.line + 1, column: start.character + 1 }] } catch {
      return [{ file: uri, line: start.line + 1, column: start.character + 1, outside: true }]
    }
  })
}

export class LspClient implements NavigationClient {
  state: LanguageServerState = 'starting'
  readonly ready: Promise<void>
  private readonly requests: Requests
  private queue: Promise<unknown> = Promise.resolve()

  constructor(wire: Wire, root: string, solution: string | null, timeout = 5000) {
    this.requests = new Requests(wire, 'lsp', timeout)
    wire.onStop(() => { this.state = 'stopped' })
    const rootUri = pathToFileURL(root).href
    this.ready = this.requests.request('initialize', {
      processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: 'Project' }],
      capabilities: { general: { positionEncodings: ['utf-16'] }, textDocument: { definition: { linkSupport: true }, implementation: { linkSupport: true } } },
      initializationOptions: solution ? { solution } : {}
    }).then(() => {
      this.requests.notify('initialized', {})
      if (this.state === 'starting') this.state = 'ready'
    }).catch(error => { this.stop(); throw error })
    void this.ready.catch(() => undefined)
  }

  query(file: string, text: string, position: QueryPosition): Promise<ServerLocation[]> {
    const result = this.queue.then(() => this.runQuery(file, text, position))
    this.queue = result.catch(() => undefined)
    return result
  }

  private async runQuery(file: string, text: string, position: QueryPosition): Promise<ServerLocation[]> {
    const uri = pathToFileURL(file).href
    try {
      this.requests.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'csharp', version: 1, text } })
      const params = { textDocument: { uri }, position: { line: position.line - 1, character: position.column - 1 }, ...(position.kind === 'references' ? { context: { includeDeclaration: true } } : {}) }
      return locations(await this.requests.request(`textDocument/${position.kind}`, params))
    } finally {
      this.requests.notify('textDocument/didClose', { textDocument: { uri } })
    }
  }

  stop(): void { this.state = 'stopped'; this.requests.stop() }
}
