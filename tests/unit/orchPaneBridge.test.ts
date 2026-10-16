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
  let trust = true
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
    autoTrust: () => trust,
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
  return { svc, run, agent, bridge, writes, advance, request, dir, setTrust: (value: boolean) => (trust = value) }
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

  it('turns a usage-limit banner into a stall decision offering other models', async () => {
    const { svc, run, agent, bridge, request } = setup()
    bridge.prepare(request())
    svc.call(agent, 'get_my_task', {})
    bridge.onOutput('tab-1', 'working...\r\n\x1b[31mClaude usage limit reached. Your limit will reset at 5pm\x1b[0m\r\n')
    await bridge.settle('tab-1')
    expect(svc.task('T-1', run.id).status).toBe('stalled')
    expect(svc.openDecisions()).toEqual([expect.objectContaining({ kind: 'stall', options: ['Continue with Codex', 'Wait'], question: expect.stringContaining('5pm') })])
  })

  it("answers Claude's trust prompt step by step for the agent's own worktree, and only when allowed", async () => {
    const { bridge, writes, request, setTrust, advance } = setup()
    const screen = (folder: string, onYes = false): string =>
      `\x1b[2J\x1b[H Accessing workspace:\r\n ${folder}\r\n Quick safety check\r\n ${onYes ? ' ' : '❯'} No, exit\r\n ${onYes ? '❯' : ' '} Yes, I trust this folder\r\n Enter to confirm · Esc to cancel\r\n`
    const show = async (tab: string, folder: string, onYes = false): Promise<void> => {
      bridge.onOutput(tab, screen(folder, onYes))
      await bridge.settle(tab)
    }
    bridge.prepare(request({ id: 'tab-2', cwd: 'C:/wt/other' }))
    await show('tab-2', 'C:/somewhere/else')
    expect(writes).toEqual([])
    bridge.prepare(request({ cwd: 'C:/wt/fix' }))
    setTrust(false)
    await show('tab-1', 'C:/wt/fix')
    expect(writes).toEqual([])
    setTrust(true)
    await show('tab-1', 'C:/wt/fix')
    // The menu takes keys only a moment after it appears, so Dawsha waits before pressing Down.
    expect(writes).toEqual([])
    advance(1_500)
    expect(writes).toEqual(['\x1b[B'])
    // The cursor has not moved yet: nothing more until the screen shows it on "Yes".
    await show('tab-1', 'C:/wt/fix')
    expect(writes).toEqual(['\x1b[B'])
    await show('tab-1', 'C:/wt/fix', true)
    expect(writes).toEqual(['\x1b[B', '\r'])
    await show('tab-1', 'C:/wt/fix', true)
    expect(writes).toEqual(['\x1b[B', '\r'])
  })

  it('types the first message after the trust prompt when the agent has not connected, and not when it has', async () => {
    const { svc, agent, bridge, writes, request, advance } = setup()
    svc.setLaunch(agent.id, { ...svc.agent(agent.id)!.launch!, firstMessage: 'You are the fixer. Call whoami.' })
    const yesScreen = '\x1b[2J\x1b[H Accessing workspace:\r\n C:/wt/fix\r\n Quick safety check\r\n   No, exit\r\n ❯ Yes, I trust this folder\r\n Enter to confirm · Esc to cancel\r\n'
    bridge.prepare(request({ cwd: 'C:/wt/fix' }))
    bridge.onOutput('tab-1', yesScreen)
    await bridge.settle('tab-1')
    expect(writes).toEqual(['\r'])
    advance(5_000)
    expect(writes).toEqual(['\r', 'You are the fixer. Call whoami.'])

    const second = setup()
    second.svc.setLaunch(second.agent.id, { ...second.svc.agent(second.agent.id)!.launch!, firstMessage: 'Hello' })
    second.bridge.prepare(second.request({ cwd: 'C:/wt/fix' }))
    second.bridge.onOutput('tab-1', yesScreen)
    await second.bridge.settle('tab-1')
    second.svc.call(second.agent, 'whoami', {})
    second.advance(5_000)
    expect(second.writes).toEqual(['\r'])
  })

  it('repeats a lost Down a few times but never presses Enter while the cursor is on "No"', async () => {
    const { bridge, writes, request, advance } = setup()
    bridge.prepare(request({ cwd: 'C:/wt/fix', cols: 60, rows: 12 }))
    // Like Claude's interface: each line placed with a cursor position instead of a newline.
    const at = (row: number, text: string): string => `\x1b[${row};1H${text}`
    bridge.onOutput('tab-1', ['\x1b[2J', at(2, ' Accessing workspace:'), at(3, ' C:/wt/fix'), at(4, ' Quick safety check: trust it?'), at(6, ' ❯ No, exit'), at(7, '   Yes, I trust this folder'), at(9, ' Enter to confirm · Esc to cancel')].join(''))
    await bridge.settle('tab-1')
    expect(writes).toEqual([])
    // No new output at all: Dawsha re-checks on its own timer and gives up after three presses.
    for (let i = 0; i < 6; i += 1) advance(1_500)
    expect(writes).toEqual(['\x1b[B', '\x1b[B', '\x1b[B'])
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
