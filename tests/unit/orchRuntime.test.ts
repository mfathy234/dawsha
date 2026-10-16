import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrchRuntime } from '../../src/main/orch/runtime'
import { McpTestClient } from '../support/orchMcpClient'

describe('OrchRuntime', () => {
  it('starts the store and MCP server once and stops them cleanly', async () => {
    const runtime = new OrchRuntime(join(mkdtempSync(join(tmpdir(), 'orch-rt-')), 'orchestrator.db'), '9.9.9')
    expect(runtime.running).toBe(false)
    const server = await runtime.start()
    expect(await runtime.start()).toBe(server)
    const service = runtime.service
    if (!service) throw new Error('service missing')
    const run = service.createRun({ projectPath: 'p', title: 't', story: 's', plan: 'Default' })
    const agent = service.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
    const init = await new McpTestClient(server.url, agent.token).request('initialize', {})
    expect(init.result.serverInfo).toEqual({ name: 'dawsha-orch', version: '9.9.9' })
    await runtime.stop()
    await runtime.stop()
    expect(runtime.running).toBe(false)
    await expect(fetch(server.url, { method: 'POST' })).rejects.toThrow()
  })
})
