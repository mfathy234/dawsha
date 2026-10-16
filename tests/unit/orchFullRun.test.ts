import { afterEach, describe, expect, it } from 'vitest'
import { startOrchMcpServer, type OrchMcpServer } from '../../src/main/orch/mcpServer'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import type { OrchRole } from '../../src/shared/orch/types'
import { McpTestClient } from '../support/orchMcpClient'

const servers: OrchMcpServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

describe('a full orchestrated run over MCP', () => {
  it('goes from story to approved work with a review loop and a dependency', async () => {
    const svc = new OrchService(new OrchStore(':memory:'))
    const server = await startOrchMcpServer(svc)
    servers.push(server)
    const run = svc.createRun({ projectPath: 'C:/work/dawsha', title: 'Export usage as CSV', story: 'As a user I want a CSV.', plan: 'Default' })
    const join = (role: OrchRole, runner: string, model: string): McpTestClient =>
      new McpTestClient(server.url, svc.registerAgent({ runId: run.id, role, runner, model }).token)
    const lead = join('lead', 'claude', 'opus')
    const spec = join('spec-writer', 'claude', 'sonnet')
    const impl = join('implementer', 'codex', 'gpt-codex')
    const rev = join('code-reviewer', 'claude', 'sonnet')
    const tester = join('tester', 'gemini', 'flash')

    // Spec, then the human approves it.
    await lead.callTool('create_task', { title: 'Write the spec', spec: 'From the story.', role: 'spec-writer' })
    expect((await spec.callTool('get_my_task')).json.key).toBe('T-1')
    await spec.callTool('complete_task', { summary: 'spec v1', files: ['.dawsha/runs/x/spec.md'] })
    const [approval] = svc.openDecisions()
    expect(approval.kind).toBe('spec-approval')
    svc.answerDecision(approval.id, 'Approve')
    expect(svc.task('T-1', run.id).status).toBe('approved')

    // The lead plans two tasks; the tester waits for the implementer.
    await lead.callTool('create_task', { title: 'CSV writer', spec: 'Write it.', role: 'implementer', review: true, acceptance: ['UTF-8 BOM'] })
    await lead.callTool('create_task', { title: 'Check criteria', spec: 'Test it.', role: 'tester', depends_on: ['T-2'] })
    expect((await tester.callTool('get_my_task')).json.task).toBeNull()

    // Implement, get rejected once, fix, get approved.
    expect((await impl.callTool('get_my_task')).json.key).toBe('T-2')
    await impl.callTool('update_task', { progress: 'Writer done, adding tests.' })
    expect((await impl.callTool('complete_task', { summary: 'v1', files: ['csv.ts'], tests: '3 passed' })).json.review_task).toBe('T-4')
    const review1 = (await rev.callTool('get_my_task')).json
    expect(review1).toMatchObject({ key: 'T-4', reviewOf: 'T-2' })
    expect(review1.spec).toContain('UTF-8 BOM')
    await rev.callTool('submit_review', { verdict: 'reject', comments: 'BOM missing in chunks' })
    const inbox = (await impl.callTool('fetch_inbox')).json
    expect(inbox[0].body).toContain('BOM missing in chunks')
    expect((await impl.callTool('get_my_task')).json).toMatchObject({ key: 'T-2', reviewRound: 1, feedback: 'BOM missing in chunks' })
    await impl.callTool('complete_task', { summary: 'v2 with BOM per file' })
    expect((await rev.callTool('get_my_task')).json.key).toBe('T-5')
    await rev.callTool('submit_review', { verdict: 'approve', comments: 'Good.' })
    expect(svc.task('T-2', run.id).status).toBe('approved')

    // Now the tester can start, and finishing needs no review.
    expect((await tester.callTool('get_my_task')).json.key).toBe('T-3')
    expect((await tester.callTool('complete_task', { summary: 'All criteria pass' })).json.status).toBe('approved')

    const statuses = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5'].map((key) => svc.task(key, run.id).status)
    expect(statuses).toEqual(['approved', 'approved', 'approved', 'approved', 'approved'])
    const log = svc.events(run.id).map((event) => event.text)
    expect(log[0]).toBe('Run started: Export usage as CSV')
    expect(log.some((text) => text.includes('T-2 rejected (round 1)'))).toBe(true)
    expect(log.some((text) => text.includes('T-2 approved by code-reviewer'))).toBe(true)
    expect(log.at(-1)).toBe('T-3 done')
  })
})
