// A minimal MCP client that behaves like an agent CLI talking to Dawsha's orch server.

export interface RawReply {
  status: number
  json: any
}

export interface ToolReply {
  isError: boolean | undefined
  json: any
  text: string
}

export class McpTestClient {
  private nextId = 0

  constructor(private readonly url: string, private readonly token: string, private readonly origin?: string) {}

  async raw(body: string): Promise<RawReply> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.token}`
    }
    if (this.origin) headers.origin = this.origin
    const res = await fetch(this.url, { method: 'POST', headers, body })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: res.status, json }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<any> {
    this.nextId += 1
    return (await this.raw(JSON.stringify({ jsonrpc: '2.0', id: this.nextId, method, params }))).json
  }

  notify(method: string, params?: Record<string, unknown>): Promise<RawReply> {
    return this.raw(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
    const reply = await this.request('tools/call', { name, arguments: args })
    const text: string = reply.result.content[0].text
    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return { isError: reply.result.isError, json, text }
  }
}
