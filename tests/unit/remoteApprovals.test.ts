import { describe, expect, it, vi } from 'vitest'
import { createRemoteApprovals, type ApprovalConfig } from '../../src/main/remoteApprovals'
import { RemoteTerminalState, type RemoteTerminalSnapshot } from '../../src/main/remoteTerminalState'
import type { Project } from '../../src/shared/types'

const box = (lines: string[]): string => lines.map((line) => `│ ${line.padEnd(60)} │`).join('\n')
const bash = (command: string): string => box(['Bash command', '', `  ${command}`, '', 'Do you want to proceed?', '❯ 1. Yes', '  2. Yes, and don\u2019t ask again', '  3. No, and tell Claude what to do differently (esc)'])
const edit = (file: string): string => box(['Edit file', file, ' 15 +   timeout-minutes: 20', `Do you want to make this edit to ${file.split('/').pop()}?`, '❯ 1. Yes', '  2. Yes, allow all edits', '  3. No, and tell Claude what to do differently (esc)'])

const project: Project = { id: 'p1', name: 'billing-api', folder: 'C:/work/billing', defaultAgent: 'codex' }

function setup(overrides: Partial<ApprovalConfig> = {}) {
  let time = 1_000_000
  let idle = 0
  const config: ApprovalConfig = { allowConfigEdits: false, notify: true, onlyWhenAway: false, awayMinutes: 3, ...overrides }
  const terminals: RemoteTerminalSnapshot[] = [
    { id: 't1', startedAt: 1, cols: 80, rows: 24, projectId: 'p1', agent: 'codex' },
    { id: 'shell', startedAt: 1, cols: 80, rows: 24, projectId: 'p1', agent: 'shell' }
  ]
  const screens = new Map<string, string>([['t1', bash('npm test')], ['shell', bash('ls')]])
  const writes: Array<{ id: string; data: string }> = []
  let clearOn: string | null = '\x1b'
  const write = vi.fn((id: string, data: string) => {
    writes.push({ id, data })
    if (data === clearOn || data === '\r') screens.set(id, 'agent is thinking...')
  })
  const approvals = createRemoteApprovals({
    terminals: { snapshot: (id) => id ? terminals.filter((terminal) => terminal.id === id) : terminals, tail: async (id) => screens.get(id) ?? null, write },
    getProjects: () => [project],
    getConfig: () => config,
    idleSeconds: () => idle,
    now: () => time,
    sleep: async (ms) => { time += ms },
    pollMs: 10
  })
  return { approvals, screens, writes, write, config, setIdle: (value: number) => { idle = value }, advance: (ms: number) => { time += ms }, keepPrompt: () => { clearOn = null } }
}

describe('remote approvals on a real mirrored screen', () => {
  it('finds a prompt drawn by a full-screen agent and answers it', async () => {
    const mirror = new RemoteTerminalState()
    mirror.add('t1', 1, { projectId: 'p1', agent: 'claude' }, { cols: 80, rows: 24 })
    const writes: string[] = []
    const approvals = createRemoteApprovals({
      terminals: {
        snapshot: (id) => mirror.snapshot(id),
        tail: (id) => mirror.tail(id),
        write: (_id, data) => { writes.push(data); if (data === '\x1b') mirror.append('t1', '\u001b[2J\u001b[Hback at the prompt') }
      },
      getProjects: () => [project],
      getConfig: () => ({ allowConfigEdits: false, notify: true, onlyWhenAway: false, awayMinutes: 3 }),
      idleSeconds: () => 0
    })
    mirror.append('t1', 'earlier output\r\n' + bash('npm test').replace(/\n/g, '\r\n'))
    const [item] = (await approvals.snapshot()).items
    expect(item).toMatchObject({ id: 't1', kind: 'command', summary: 'npm test', agent: 'claude' })
    expect(await approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: false, reason: 'Use pnpm', device: 'Pixel' })).toEqual({ ok: true, reasonSent: true })
    expect(writes).toEqual(['\x1b', 'Use pnpm', '\r'])
    expect((await approvals.snapshot()).items).toEqual([])
  })
})

describe('remote approvals', () => {
  it('lists pending prompts from agent terminals only, with project, agent and wait time', async () => {
    const { approvals, advance } = setup()
    const first = await approvals.snapshot()
    expect(first.items).toHaveLength(1)
    expect(first.items[0]).toMatchObject({ id: 't1', projectName: 'billing-api', agent: 'codex', kind: 'command', summary: 'npm test', canAllow: true, restriction: null })
    expect(first.items[0].title).toBe('Codex needs you')
    advance(120_000)
    const later = await approvals.snapshot()
    expect(later.items[0].since).toBe(first.items[0].since)
  })

  it('lists nothing when the screen has no prompt', async () => {
    const { approvals, screens } = setup()
    screens.set('t1', 'working...')
    expect((await approvals.snapshot()).items).toEqual([])
  })

  it('allows with Enter and records the answer with the device name', async () => {
    const { approvals, writes } = setup()
    const [item] = (await approvals.snapshot()).items
    const result = await approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: true, device: 'Pixel 8' })
    expect(result).toEqual({ ok: true, reasonSent: false })
    expect(writes).toEqual([{ id: 't1', data: '\r' }])
    const { history } = await approvals.snapshot()
    expect(history[0]).toMatchObject({ allowed: true, summary: 'npm test', source: 'phone', device: 'Pixel 8', agent: 'codex', projectName: 'billing-api' })
  })

  it('refuses a stale fingerprint and writes nothing', async () => {
    const { approvals, writes, screens } = setup()
    const [item] = (await approvals.snapshot()).items
    screens.set('t1', bash('rm -rf dist'))
    const result = await approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: true, device: 'Pixel 8' })
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(writes).toEqual([])
  })

  it('refuses when the prompt is already gone, or the session ended', async () => {
    const { approvals, writes, screens } = setup()
    const [item] = (await approvals.snapshot()).items
    screens.set('t1', 'done')
    expect(await approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: false, device: 'x' })).toMatchObject({ ok: false, status: 409 })
    expect(await approvals.answer({ id: 'gone', fingerprint: item.fingerprint, allow: true, device: 'x' })).toMatchObject({ ok: false, status: 404 })
    expect(await approvals.answer({ id: 'shell', fingerprint: item.fingerprint, allow: true, device: 'x' })).toMatchObject({ ok: false, status: 404 })
    expect(writes).toEqual([])
  })

  it('denies with Escape, waits for the prompt to clear, then types the sanitised reason and Enter', async () => {
    const { approvals, writes } = setup()
    const [item] = (await approvals.snapshot()).items
    const result = await approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: false, reason: '/exit\nUse pnpm\u0007', device: 'Pixel 8' })
    expect(result).toEqual({ ok: true, reasonSent: true })
    expect(writes).toEqual([{ id: 't1', data: '\x1b' }, { id: 't1', data: 'exit Use pnpm' }, { id: 't1', data: '\r' }])
    expect((await approvals.snapshot()).history[0]).toMatchObject({ allowed: false, reason: true })
  })

  it('does not type the reason when the prompt never clears', async () => {
    const { approvals, writes, keepPrompt } = setup()
    keepPrompt()
    const [item] = (await approvals.snapshot()).items
    const result = await approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: false, reason: 'Stop', device: 'x' })
    expect(result).toEqual({ ok: true, reasonSent: false })
    expect(writes).toEqual([{ id: 't1', data: '\x1b' }])
  })

  it('denies without a reason by sending only Escape', async () => {
    const { approvals, writes } = setup()
    const [item] = (await approvals.snapshot()).items
    await approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: false, reason: '   ', device: 'x' })
    expect(writes).toEqual([{ id: 't1', data: '\x1b' }])
  })

  it('never types a reason with an allow', async () => {
    const { approvals, writes } = setup()
    const [item] = (await approvals.snapshot()).items
    await approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: true, reason: 'sneaky', device: 'x' })
    expect(writes).toEqual([{ id: 't1', data: '\r' }])
  })

  it('only lets CI and config edits be denied from the phone unless the setting allows them', async () => {
    const closed = setup()
    closed.screens.set('t1', edit('.github/workflows/ci.yml'))
    const [item] = (await closed.approvals.snapshot()).items
    expect(item).toMatchObject({ kind: 'edit', restriction: 'config', canAllow: false })
    expect(await closed.approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: true, device: 'x' })).toMatchObject({ ok: false, status: 403 })
    expect(closed.writes).toEqual([])
    expect(await closed.approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: false, device: 'x' })).toMatchObject({ ok: true })
    expect(closed.writes).toEqual([{ id: 't1', data: '\x1b' }])

    const open = setup({ allowConfigEdits: true })
    open.screens.set('t1', edit('.github/workflows/ci.yml'))
    const [allowed] = (await open.approvals.snapshot()).items
    expect(allowed.canAllow).toBe(true)
    expect(await open.approvals.answer({ id: 't1', fingerprint: allowed.fingerprint, allow: true, device: 'x' })).toMatchObject({ ok: true })
  })

  it('treats an edit outside the project folder as restricted', async () => {
    const { approvals, screens } = setup()
    screens.set('t1', edit('C:/Users/me/.ssh/config'))
    expect((await approvals.snapshot()).items[0]).toMatchObject({ restriction: 'outside-project', canAllow: false })
  })

  it('records desktop answers and keeps only the last 50', async () => {
    const { approvals, screens } = setup()
    await approvals.recordDesktopAnswer('t1', false)
    expect((await approvals.snapshot()).history[0]).toMatchObject({ allowed: false, source: 'desktop', device: 'This computer' })
    for (let index = 0; index < 60; index += 1) {
      screens.set('t1', bash(`cmd ${index}`))
      await approvals.recordDesktopAnswer('t1', true)
    }
    const { history } = await approvals.snapshot()
    expect(history).toHaveLength(50)
    expect(history[0].summary).toBe('cmd 59')
    screens.set('t1', 'no prompt')
    await approvals.recordDesktopAnswer('t1', true)
    expect((await approvals.snapshot()).history[0].summary).toBe('cmd 59')
  })

  it('rejects a second answer while one is in flight', async () => {
    const { approvals, writes } = setup()
    const [item] = (await approvals.snapshot()).items
    const [first, second] = await Promise.all([
      approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: true, device: 'a' }),
      approvals.answer({ id: 't1', fingerprint: item.fingerprint, allow: true, device: 'b' })
    ])
    expect([first.ok, second.ok].sort()).toEqual([false, true])
    expect(writes).toHaveLength(1)
  })

  it('suppresses notifications while the desktop is in use when only-when-away is on', async () => {
    const { approvals, setIdle } = setup({ onlyWhenAway: true, awayMinutes: 3 })
    expect((await approvals.snapshot()).notify).toBe(false)
    setIdle(179)
    expect((await approvals.snapshot()).notify).toBe(false)
    setIdle(180)
    expect((await approvals.snapshot()).notify).toBe(true)
  })

  it('turns notifications off with the notify setting and keeps prompts listed', async () => {
    const { approvals } = setup({ notify: false })
    const payload = await approvals.snapshot()
    expect(payload.notify).toBe(false)
    expect(payload.items).toHaveLength(1)
  })

  it('pushes changes to subscribers and stops polling when the last one leaves', async () => {
    vi.useFakeTimers()
    try {
      const { approvals, screens } = setup()
      const seen: number[] = []
      const stop = approvals.subscribe((payload) => seen.push(payload.items.length))
      await vi.advanceTimersByTimeAsync(30)
      expect(seen).toEqual([1])
      screens.set('t1', 'working')
      await vi.advanceTimersByTimeAsync(30)
      expect(seen).toEqual([1, 0])
      stop()
      screens.set('t1', bash('npm test'))
      await vi.advanceTimersByTimeAsync(100)
      expect(seen).toEqual([1, 0])
    } finally { vi.useRealTimers() }
  })
})
