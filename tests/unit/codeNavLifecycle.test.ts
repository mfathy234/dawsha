import { expect, it } from 'vitest'
import { TsServerClient } from '../../src/main/codeNav/tsserver'
import { LspClient } from '../../src/main/codeNav/lsp'
import type { Wire } from '../../src/main/codeNav/transport'

function immediateWire(protocol: 'ts' | 'lsp'): Wire {
  let receive: (message: unknown) => void = () => undefined
  return {
    onMessage: listener => { receive = listener },
    onStop: () => undefined,
    stop: () => undefined,
    send: raw => {
      const message = raw as { seq: number; id: number }
      receive(protocol === 'ts' ? { type: 'response', request_seq: message.seq, success: true } : { jsonrpc: '2.0', id: message.id, result: { capabilities: {} } })
    }
  }
}

it.each(['ts', 'lsp'] as const)('does not become ready after stopping during %s initialization', async protocol => {
  const wire = immediateWire(protocol)
  const client = protocol === 'ts' ? new TsServerClient(wire) : new LspClient(wire, process.cwd(), null)
  client.stop()
  await client.ready
  expect(client.state).toBe('stopped')
})
