import { afterEach, describe, expect, it } from 'vitest'
import { startOrchMcpServer, type OrchMcpServer } from '../../src/main/orch/mcpServer'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import { McpTestClient } from '../support/orchMcpClient'

const servers: OrchMcpServer[] = []
afterEach(async () => { for (const s of servers.splice(0)) await s.close() })

async function boot() {
  const svc = new OrchService(new OrchStore(':memory:'))
  const server = await startOrchMcpServer(svc)
  servers.push(server)
  const run = svc.createRun({ projectPath: 'C:/p', title: 'x', story: 's', plan: 'Default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  const impl = svc.registerAgent({ runId: run.id, role: 'implementer', runner: 'codex', model: 'gpt' })
  return { svc, server, lead, impl, url: server.url }
}

describe('orch MCP server', () => {
  it('initializes and lists only the tools for the agent role', async () => {
    const { url, impl } = await boot()
    const c = new McpTestClient(url, impl.token)
    const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(init.result.serverInfo.name).toBe('dawsha-orch')
    expect((await c.notify('notifications/initialized')).status).toBe(202)
    const names = (await c.request('tools/list')).result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('complete_task')
    expect(names).not.toContain('create_task')
  })
  it('runs tool calls and reports tool errors as isError', async () => {
    const { url, lead, impl } = await boot()
    const l = new McpTestClient(url, lead.token)
    const created = await l.callTool('create_task', { title: 'A', spec: 's', role: 'implementer' })
    expect(created.isError).toBeFalsy()
    const i = new McpTestClient(url, impl.token)
    expect((await i.callTool('get_my_task', {})).json.key).toBe('T-1')
    const denied = await i.callTool('create_task', { title: 'B', spec: 's', role: 'ui' })
    expect(denied.isError).toBe(true)
  })
  it('rejects missing tokens, foreign origins and huge bodies', async () => {
    const { url, impl } = await boot()
    expect((await new McpTestClient(url, 'wrong').raw('{}')).status).toBe(401)
    expect((await new McpTestClient(url, impl.token, 'https://evil.example').raw('{}')).status).toBe(403)
    expect((await new McpTestClient(url, impl.token).raw('x'.repeat(1_100_000))).status).toBe(413)
    expect((await new McpTestClient(url, impl.token).raw('{"jsonrpc":"2.0","id":1,"method":"nope"}')).json.error.code).toBe(-32601)
  })
})
