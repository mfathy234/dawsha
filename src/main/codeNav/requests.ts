import type { Wire } from './transport'

type Message = Record<string, unknown>
interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }

export class Requests {
  private sequence = 0
  private readonly pending = new Map<number, Pending>()
  private stopped = false

  constructor(readonly wire: Wire, private readonly protocol: 'ts' | 'lsp', private readonly timeout: number) {
    wire.onMessage(message => this.receive(message))
    wire.onStop(() => this.close())
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error('Language server stopped.'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Language server request timed out.'))
      }, this.timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.wire.send(this.protocol === 'ts' ? { seq: id, type: 'request', command: method, arguments: params } : { jsonrpc: '2.0', id, method, params })
      } catch { this.close() }
    })
  }

  notify(method: string, params: unknown): void {
    if (this.stopped) return
    this.wire.send(this.protocol === 'ts' ? { seq: ++this.sequence, type: 'request', command: method, arguments: params } : { jsonrpc: '2.0', method, params })
  }

  private receive(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const message = raw as Message
    if (this.protocol === 'lsp' && typeof message.method === 'string' && message.id !== undefined) {
      const params = message.params as { items?: unknown[] } | undefined
      const result = message.method === 'workspace/configuration' ? (params?.items ?? []).map(() => null) : message.method === 'workspace/applyEdit' ? { applied: false } : null
      this.wire.send({ jsonrpc: '2.0', id: message.id, result })
      return
    }
    const id = this.protocol === 'ts' ? message.request_seq : message.id
    if (typeof id !== 'number') return
    const request = this.pending.get(id)
    if (!request) return
    clearTimeout(request.timer)
    this.pending.delete(id)
    const failed = this.protocol === 'ts' ? message.success !== true : message.error !== undefined
    if (failed) request.reject(new Error('Language server could not answer this request.'))
    else request.resolve(this.protocol === 'ts' ? message.body : message.result)
  }

  private close(): void {
    this.stopped = true
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Language server stopped.'))
    }
    this.pending.clear()
  }

  stop(): void { this.close(); this.wire.stop() }
}
