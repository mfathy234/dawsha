import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrchRuntime } from '../../src/main/orch/runtime'
import { defaultOrchSettings } from '../../src/shared/orch/profiles'
import { McpTestClient } from '../support/orchMcpClient'

function runtime() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-rt-'))
  return new OrchRuntime({
    dbPath: join(dir, 'orchestrator.db'),
    configRoot: join(dir, 'agents'),
    version: '9.9.9',
    log: () => undefined,
    settings: defaultOrchSettings,
    projectFolder: (id) => (id === 'known' ? dir : null),
    writePty: () => undefined,
    openPane: () => undefined,
    closePane: () => undefined,
    changed: () => undefined
  })
}

describe('OrchRuntime', () => {
  it('starts the store and MCP server once and stops them cleanly', async () => {
    const rt = runtime()
    expect(rt.running).toBe(false)
    const server = await rt.start()
    expect(await rt.start()).toBe(server)
    const service = rt.service
    if (!service) throw new Error('service missing')
    const run = service.createRun({ projectPath: 'p', title: 't', story: 's', plan: 'default' })
    const agent = service.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
    const init = await new McpTestClient(server.url, agent.token).request('initialize', {})
    expect(init.result.serverInfo).toEqual({ name: 'dawsha-orch', version: '9.9.9' })
    await rt.stop()
    await rt.stop()
    expect(rt.running).toBe(false)
    await expect(fetch(server.url, { method: 'POST' })).rejects.toThrow()
  })

  it('explains why a run cannot start', async () => {
    const rt = runtime()
    const input = { kind: 'bug' as const, projectId: 'known', title: '', story: 'Crash on export', planId: 'default', fixerProfileId: null }
    expect(rt.startRun(input)).toEqual({ ok: false, error: expect.stringContaining('orchestrator is not running') })
    await rt.start()
    expect(rt.startRun({ ...input, projectId: 'gone' })).toEqual({ ok: false, error: 'That project no longer exists.' })
    expect(rt.startRun({ ...input, story: '  ' })).toEqual({ ok: false, error: 'Describe the bug first.' })
    await rt.stop()
  })

  it('refuses to start an orchestrated pane while the orchestrator is off', () => {
    const rt = runtime()
    const request = { id: 't', agent: 'claude' as const, cwd: 'C:/', resume: false, cols: 80, rows: 24 }
    expect(rt.prepareSpawn(request)).toBeNull()
    expect(rt.prepareSpawn({ ...request, orchAgentId: 'a1' })).toEqual({ error: expect.stringContaining('Restart Dawsha') })
  })
})
