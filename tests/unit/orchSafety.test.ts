import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { startOrchMcpServer, type OrchMcpServer } from '../../src/main/orch/mcpServer'
import { MAX_OPEN_DECISIONS_PER_AGENT, OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import { McpTestClient } from '../support/orchMcpClient'

function setup() {
  let t = 0
  const store = new OrchStore(':memory:')
  const svc = new OrchService(store, () => (t += 1))
  const run = svc.createRun({ projectPath: 'C:/p', title: 'x', story: 's', plan: 'Default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  const impl = svc.registerAgent({ runId: run.id, role: 'implementer', runner: 'codex', model: 'gpt' })
  const rev = svc.registerAgent({ runId: run.id, role: 'code-reviewer', runner: 'claude', model: 'sonnet' })
  return { store, svc, run, lead, impl, rev }
}

const servers: OrchMcpServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

describe('orchestrator safety (review fixes)', () => {
  it('rolls back every write when an operation fails halfway', () => {
    const { store, run } = setup()
    expect(() =>
      store.transaction(() => {
        store.putNote({ runId: run.id, key: 'half', text: 'written', author: 'x', updatedAt: 1 })
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(store.listNotes(run.id).map((n) => n.key)).not.toContain('half')
  })

  it('keeps an agent on one task while its work is in review, so a rejection lands on the right task', () => {
    const { svc, run, lead, impl, rev } = setup()
    svc.call(lead, 'create_task', { title: 'A', spec: 's', role: 'implementer' })
    svc.call(lead, 'create_task', { title: 'B', spec: 's', role: 'implementer' })
    svc.call(impl, 'get_my_task', {})
    svc.call(impl, 'complete_task', { summary: 'A done' })
    expect(svc.call(impl, 'get_my_task', {})).toMatchObject({ task: null, message: expect.stringContaining('T-1 is in review') })
    svc.call(rev, 'get_my_task', {})
    svc.call(rev, 'submit_review', { verdict: 'reject', comments: 'fix A' })
    expect(svc.call(impl, 'get_my_task', {})).toMatchObject({ key: 'T-1', feedback: 'fix A' })
    expect(svc.task('T-2', run.id).status).toBe('todo')
  })

  it('only hands over unfinished work that is not waiting for review, and moves open decisions', () => {
    const { svc, run, lead, impl } = setup()
    svc.call(lead, 'create_task', { title: 'A', spec: 's', role: 'implementer' })
    expect(() => svc.handoffTask(run.id, 'T-1', { runner: 'claude', model: 'sonnet' })).toThrow(/todo/)
    svc.call(impl, 'get_my_task', {})
    svc.call(impl, 'ask_human', { question: 'Which format?' })
    const { agent } = svc.handoffTask(run.id, 'T-1', { runner: 'claude', model: 'sonnet' })
    expect(svc.openDecisions()[0].agentId).toBe(agent.id)
    svc.answerDecision(svc.openDecisions()[0].id, 'CSV')
    const inbox = svc.call(agent, 'fetch_inbox', {}) as { body: string }[]
    expect(inbox.map((m) => m.body).join('\n')).toContain('CSV')
    svc.call(agent, 'complete_task', { summary: 'done' })
    expect(() => svc.handoffTask(run.id, 'T-1', { runner: 'gemini', model: 'pro' })).toThrow(/done pending review/)
  })

  it('stores only a hash of agent tokens', () => {
    const { store, svc, impl } = setup()
    expect(store.getAgent(impl.id)?.token).not.toBe(impl.token)
    expect(svc.agentForToken(impl.token)?.id).toBe(impl.id)
    expect(svc.agentForToken(store.getAgent(impl.id)?.token ?? '')).toBeUndefined()
  })

  it('protects the human answers in notes from agents', () => {
    const { svc, lead, impl } = setup()
    svc.call(lead, 'create_task', { title: 'A', spec: 's', role: 'implementer' })
    svc.call(impl, 'get_my_task', {})
    const asked = svc.call(impl, 'ask_human', { question: 'Q?' }) as { decision_id: string }
    svc.answerDecision(asked.decision_id, 'Yes')
    expect(() => svc.call(impl, 'put_note', { key: `decision:${asked.decision_id}`, text: 'No' })).toThrow(/reserved/)
  })

  it('reuses an open question instead of opening another, and caps questions per agent', () => {
    const { svc, lead, impl } = setup()
    svc.call(lead, 'create_task', { title: 'A', spec: 's', role: 'implementer' })
    svc.call(impl, 'get_my_task', {})
    const first = svc.call(impl, 'ask_human', { question: 'One?' }) as { decision_id: string }
    const second = svc.call(impl, 'ask_human', { question: 'Two?' }) as { decision_id: string }
    expect(second.decision_id).toBe(first.decision_id)
    expect(svc.openDecisions()).toHaveLength(1)
    for (let i = 1; i < MAX_OPEN_DECISIONS_PER_AGENT; i += 1) svc.call(lead, 'ask_human', { question: `Lead ${i}?` })
    svc.call(lead, 'ask_human', { question: 'Last allowed?' })
    expect(() => svc.call(lead, 'ask_human', { question: 'Too many?' })).toThrow(/waiting for the human/)
  })

  it('cancels a review whose original was cancelled instead of approving it', () => {
    const { svc, run, lead, impl, rev } = setup()
    svc.call(lead, 'create_task', { title: 'A', spec: 's', role: 'implementer' })
    svc.call(impl, 'get_my_task', {})
    svc.call(impl, 'block_task', { reason: 'missing API key' })
    svc.answerDecision(svc.openDecisions()[0].id, 'Cancel task')
    expect(svc.task('T-1', run.id).status).toBe('cancelled')
    expect(svc.call(rev, 'get_my_task', {})).toMatchObject({ task: null })
  })

  it('accepts "Approve." for a spec approval', () => {
    const { svc, run, lead } = setup()
    const spec = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
    svc.call(lead, 'create_task', { title: 'Spec', spec: 's', role: 'spec-writer' })
    svc.call(spec, 'get_my_task', {})
    svc.call(spec, 'complete_task', { summary: 'v1' })
    svc.answerDecision(svc.openDecisions()[0].id, ' Approve. ')
    expect(svc.task('T-1', run.id).status).toBe('approved')
  })

  it('rejects oversized arguments', () => {
    const { svc, lead } = setup()
    expect(() => svc.call(lead, 'create_task', { title: 'A', spec: 'x'.repeat(20_001), role: 'ui' })).toThrow(/at most/)
  })

  it('answers null params, foreign hosts and broken batch items without failing the request', async () => {
    const { svc, impl } = setup()
    const server = await startOrchMcpServer(svc)
    servers.push(server)
    const client = new McpTestClient(server.url, impl.token)
    const nullParams = await client.raw('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":null}')
    expect(nullParams.status).toBe(200)
    expect(nullParams.json.error.code).toBe(-32602)
    const batch = await client.raw('[{"jsonrpc":"2.0","id":1,"method":"ping"},42,{"jsonrpc":"2.0","id":3,"method":"ping"}]')
    expect(batch.json.map((r: { id: number | null }) => r.id)).toEqual([1, null, 3])
    // fetch rewrites Host, so send the forged Host header with node:http.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: server.port, path: '/mcp', method: 'POST', headers: { host: `evil.example:${server.port}`, authorization: `Bearer ${impl.token}` } },
        (res) => { res.resume(); resolve(res.statusCode ?? 0) }
      )
      req.on('error', reject)
      req.end('{}')
    })
    expect(status).toBe(403)
  })
})
