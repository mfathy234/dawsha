import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrchPaneBridge, launchArgsFor } from '../../src/main/orch/paneBridge'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import type { SpawnRequest } from '../../src/shared/types'

function setup() {
  let now = 1_000_000
  const timers: { at: number; fn: () => void }[] = []
  const writes: string[] = []
  const svc = new OrchService(new OrchStore(':memory:'), () => now)
  const run = svc.startRun({ kind: 'bug', projectPath: 'C:/work/app', title: 'Crash', story: 'It throws.', plan: 'default' })
  const agent = svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'claude', model: 'opus' })
  const dir = mkdtempSync(join(tmpdir(), 'orch-bridge-'))
  svc.setLaunch(agent.id, { agent: 'claude', args: ['--model', 'opus', '--session-id', 's-1', '--mcp-config', join(dir, 'mcp.json')], env: { X: '1' }, files: [{ path: join(dir, 'mcp.json'), content: '{"a":1}' }] })
  svc.assignTask(run.id, 'T-1', agent.id)
  const bridge = new OrchPaneBridge({
    service: () => svc,
    write: (_tab, data) => writes.push(data),
    stallOptions: () => ['Continue with Codex', 'Wait'],
    quietMinutes: () => 10,
    now: () => now,
    setTimer: (fn, ms) => timers.push({ at: now + ms, fn })
  })
  const advance = (ms: number): void => {
    now += ms
    for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (timer.at <= now) timer.fn()
      else timers.push(timer)
    }
  }
  const request = (over: Partial<SpawnRequest> = {}): SpawnRequest =>
    ({ id: 'tab-1', agent: 'claude', cwd: 'C:/wt', resume: false, cols: 80, rows: 24, orchAgentId: agent.id, ...over })
  return { svc, run, agent, bridge, writes, advance, request, dir }
}

describe('orchestrator pane bridge', () => {
  it('leaves plain panes alone', () => {
    const { bridge, request } = setup()
    expect(bridge.prepare(request({ orchAgentId: undefined }))).toBeNull()
  })

  it('adds the launch args, a fresh token and the config files to an orchestrated spawn', () => {
    const { svc, agent, bridge, request, dir } = setup()
    const extras = bridge.prepare(request())
    if (!extras || 'error' in extras) throw new Error('expected extras')
    expect(extras.args).toEqual(['--model', 'opus', '--session-id', 's-1', '--mcp-config', join(dir, 'mcp.json')])
    expect(extras.env.X).toBe('1')
    expect(svc.agentForToken(extras.env.DAWSHA_ORCH_TOKEN)?.id).toBe(agent.id)
    expect(svc.agentForToken(agent.token)).toBeUndefined()
    expect(readFileSync(join(dir, 'mcp.json'), 'utf8')).toBe('{"a":1}')
  })

  it('drops --session-id when the pane resumes its session', () => {
    expect(launchArgsFor(['--model', 'opus', '--session-id', 's-1', '--x'], true)).toEqual(['--model', 'opus', '--x'])
    expect(launchArgsFor(['-m', 'gpt'], true)).toEqual(['-m', 'gpt'])
  })

  it('refuses to start a retired agent', () => {
    const { svc, agent, bridge, request } = setup()
    svc.releaseAgent(agent.id, 'closed')
    expect(bridge.prepare(request())).toEqual({ error: expect.stringContaining('finished') })
  })

  it('turns a usage-limit banner into a stall decision offering other models', () => {
    const { svc, run, agent, bridge, request } = setup()
    bridge.prepare(request())
    svc.call(agent, 'get_my_task', {})
    bridge.onOutput('tab-1', 'working...\r\n\x1b[31mClaude usage limit reached. Your limit will reset at 5pm\x1b[0m\r\n')
    expect(svc.task('T-1', run.id).status).toBe('stalled')
    expect(svc.openDecisions()).toEqual([expect.objectContaining({ kind: 'stall', options: ['Continue with Codex', 'Wait'], question: expect.stringContaining('5pm') })])
  })

  it('releases the task when the pane closes', () => {
    const { svc, run, agent, bridge, request } = setup()
    bridge.prepare(request())
    bridge.onClosed('tab-1', 'Pane closed')
    expect(svc.agent(agent.id)?.retiredAt).not.toBeNull()
    expect(svc.task('T-1', run.id).status).toBe('todo')
  })

  it('nudges an agent with unread messages once it is quiet, and presses Enter again if nothing happens', () => {
    const { svc, run, agent, bridge, writes, advance, request } = setup()
    bridge.prepare(request())
    svc.call(agent, 'get_my_task', {})
    svc.call(agent, 'ask_human', { question: 'Disable or message?' })
    svc.answerDecision(svc.openDecisions()[0].id, 'Message')
    advance(1000)
    bridge.poll()
    expect(writes).toEqual([])
    advance(3000)
    bridge.poll()
    expect(writes).toEqual(['Dawsha: you have new messages. Call fetch_inbox, then continue your task.'])
    advance(400)
    expect(writes.at(-1)).toBe('\r')
    advance(5000)
    expect(writes.filter((w) => w === '\r')).toHaveLength(2)
    advance(200)
    bridge.onOutput('tab-1', 'Calling fetch_inbox...')
    advance(5000)
    expect(writes.filter((w) => w === '\r')).toHaveLength(2)
    bridge.poll()
    expect(writes.filter((w) => w.startsWith('Dawsha:'))).toHaveLength(1)
    expect(svc.task('T-1', run.id).status).toBe('in_progress')
  })

  it('asks a silent agent once, then reports it as stalled', () => {
    const { svc, run, agent, bridge, writes, advance, request } = setup()
    bridge.prepare(request())
    svc.call(agent, 'get_my_task', {})
    advance(10 * 60_000)
    bridge.poll()
    expect(writes[0]).toContain('are you still working?')
    advance(6 * 60_000)
    bridge.poll()
    expect(svc.task('T-1', run.id).status).toBe('stalled')
    expect(svc.openDecisions()[0].question).toContain('No output for')
  })
})
