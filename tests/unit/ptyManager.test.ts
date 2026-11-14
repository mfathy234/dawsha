import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  data: null as null | ((data: string) => void),
  exit: null as null | ((event: { exitCode: number }) => void),
  spawn: vi.fn(),
  kill: vi.fn(),
  taskkill: vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
    queueMicrotask(() => callback(null))
  })
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: fake.taskkill
}))

vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => {
    fake.spawn(...args)
    return {
      pid: 123,
      onData: (listener: (data: string) => void) => { fake.data = listener },
      onExit: (listener: (event: { exitCode: number }) => void) => { fake.exit = listener },
      write: vi.fn(),
      resize: vi.fn(),
      kill: fake.kill
    }
  }
}))

vi.mock('../../src/main/agentLaunch', () => ({
  claudeCommand: () => 'claude',
  codexCommand: () => 'codex',
  geminiCommand: () => 'gemini',
  shellCommand: () => 'shell',
  launchSpec: (request: { agent: string; command?: string; prompt?: string }) => ({ file: request.agent === 'shell' ? 'fake-shell' : 'fake-agent', args: [request.command ?? request.prompt ?? ''] })
}))

import { PtyManager } from '../../src/main/ptyManager'
import { RemoteTerminalState } from '../../src/main/remoteTerminalState'
import type { Recorder } from '../../src/main/recorder'
import type { CrewLaunch } from '../../src/shared/crew'
import { registerPendingWorktree } from '../../src/main/worktreeSetupPending'
import { ptyArguments } from '../../src/main/commandLine'

const crewLaunch = (change: Partial<CrewLaunch>): CrewLaunch => ({ instructions: '', model: 'sonnet', effort: '', permissions: 'ask', startup: 'lean', ...change })

describe('PtyManager desktop output delivery', () => {
  let cwd: string

  beforeEach(() => {
    fake.data = null
    fake.exit = null
    fake.spawn.mockClear()
    fake.kill.mockClear()
    fake.taskkill.mockClear()
    cwd = mkdtempSync(join(tmpdir(), 'dawsha-pty-manager-'))
  })

  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  it('refuses a delayed spawn after quit has started', async () => {
    const manager = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    const quitting = manager.terminateAll(1000)
    expect(manager.spawn({ id: 'late', projectId: 'p1', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 }))
      .toEqual({ ok: false, error: 'Dawsha is shutting down' })
    await quitting
    expect(manager.spawn({ id: 'later', projectId: 'p1', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 }))
      .toEqual({ ok: false, error: 'Dawsha is shutting down' })
    expect(fake.spawn).not.toHaveBeenCalled()
  })

  it.runIf(process.platform === 'win32')('releases native PTY resources while terminating the shell trees on quit', async () => {
    const manager = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    manager.spawn({ id: 'quitting', projectId: 'p1', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 })
    await manager.terminateAll(1000)
    expect(fake.kill).toHaveBeenCalledTimes(1)
    expect(manager.activityRoots()).toEqual([])
  })

  it.runIf(process.platform === 'win32')('waits for taskkill to finish before disposing the root PTY', async () => {
    let complete: ((error: Error | null) => void) | undefined
    fake.taskkill.mockImplementationOnce((_file, _args, _options, callback) => { complete = callback })
    const manager = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    manager.spawn({ id: 'quitting', projectId: 'p1', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 })
    const quitting = manager.terminateAll(1000)
    expect(fake.taskkill).toHaveBeenCalledWith('taskkill', ['/PID', '123', '/T', '/F'], expect.objectContaining({ windowsHide: true }), expect.any(Function))
    expect(fake.kill).not.toHaveBeenCalled()
    complete?.(null)
    await quitting
    expect(fake.kill).toHaveBeenCalledTimes(1)
  })

  it.runIf(process.platform === 'win32')('bounds a hung taskkill without killing its root ahead of the tree', async () => {
    vi.useFakeTimers()
    try {
      let complete: ((error: Error | null) => void) | undefined
      fake.taskkill.mockImplementationOnce((_file, _args, _options, callback) => { complete = callback })
      const manager = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
      manager.spawn({ id: 'quitting', projectId: 'p1', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 })
      const quitting = manager.terminateAll(25)
      await vi.advanceTimersByTimeAsync(25)
      await quitting
      expect(fake.kill).not.toHaveBeenCalled()
      complete?.(new Error('taskkill timed out'))
      await Promise.resolve()
      expect(fake.kill).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not create remote replay history when remote control is disabled', () => {
    const manager = new PtyManager({ onData: vi.fn(), onExit: vi.fn() }, null)
    expect(manager.remoteSnapshot()).toEqual([])
  })

  it('keeps remote PTY output in remote snapshots without queuing it for the desktop renderer', async () => {
    const onData = vi.fn()
    const onExit = vi.fn()
    const manager = new PtyManager({ onData, onExit }, new RemoteTerminalState())
    const result = manager.spawn({ id: 'remote-1', projectId: 'p1', agent: 'codex', cwd, resume: false, cols: 80, rows: 24, desktopVisible: false })
    expect(result.ok).toBe(true)

    fake.data?.('remote output')
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(onData).not.toHaveBeenCalled()
    expect(manager.remoteSnapshot('remote-1')[0]).toMatchObject({ cols: 80, rows: 24 })
    expect((await manager.remoteScreen('remote-1'))?.output).toContain('remote output')
    manager.resize('remote-1', 50, 20)
    expect(manager.remoteSnapshot('remote-1')[0]).toMatchObject({ cols: 50, rows: 20 })

    fake.exit?.({ exitCode: 0 })
    expect(onExit).not.toHaveBeenCalled()
    expect(manager.remoteSnapshot('remote-1')).toEqual([])
  })

  it('keeps ordinary PTY output and exit delivery enabled', async () => {
    const onData = vi.fn()
    const onExit = vi.fn()
    const manager = new PtyManager({ onData, onExit })
    const result = manager.spawn({ id: 'desktop-1', projectId: 'p1', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 })
    expect(result.ok).toBe(true)

    fake.data?.('desktop output')
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(onData).toHaveBeenCalledWith('desktop-1', 'desktop output')
    fake.exit?.({ exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith('desktop-1', 0)
  })

  it('runs setup before the original agent and keeps its prompt and terminal output', async () => {
    const onData = vi.fn()
    const onExit = vi.fn()
    const onSetup = vi.fn()
    const remote = new RemoteTerminalState()
    const target = new PtyManager({ onData, onExit, onSetup }, remote, null, () => 'echo prepare')
    registerPendingWorktree(cwd, cwd)
    expect(target.spawn({ id: 'setup', projectId: 'p1', agent: 'codex', cwd, resume: false, prompt: 'Keep my first prompt', cols: 80, rows: 24 }).ok).toBe(true)
    expect(fake.spawn).toHaveBeenCalledTimes(1)
    expect(fake.spawn.mock.calls[0][0]).toBe(process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'shell')
    expect(target.setupState('setup')?.phase).toBe('running')
    fake.data?.('setup output\r\n')
    // Terminal text is untrusted and never signals a completed setup.
    fake.data?.('DAWSHA_SETUP_SUCCESS\r\n')
    expect(fake.spawn).toHaveBeenCalledTimes(1)
    fake.exit?.({ exitCode: 0 })
    expect(fake.spawn).toHaveBeenCalledTimes(2)
    expect(fake.spawn.mock.calls[1].slice(0, 2)).toEqual(['fake-agent', ptyArguments(['Keep my first prompt'])])
    expect(target.setupState('setup')).toBeNull()
    expect((await target.remoteScreen('setup'))?.output).toContain('setup output')
    expect(onExit).not.toHaveBeenCalled()
    fake.exit?.({ exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith('setup', 0)
  })

  it('keeps a failed setup waiting until retry succeeds or the owner starts the agent anyway', () => {
    const onExit = vi.fn()
    const target = new PtyManager({ onData: vi.fn(), onExit }, null, null, () => 'exit 7')
    registerPendingWorktree(cwd, cwd)
    target.spawn({ id: 'setup', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 })
    fake.exit?.({ exitCode: 7 })
    expect(target.setupState('setup')).toEqual({ phase: 'failed', exitCode: 7 })
    expect(target.activityRoots()).toEqual([])
    expect(onExit).not.toHaveBeenCalled()
    expect(target.resolveSetup('setup', 'retry').ok).toBe(true)
    expect(target.setupState('setup')?.phase).toBe('running')
    expect(fake.spawn.mock.calls.at(-1)?.[0]).toBe(process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'shell')
    fake.exit?.({ exitCode: 9 })
    expect(target.resolveSetup('setup', 'start').ok).toBe(true)
    expect(fake.spawn.mock.calls.at(-1)?.[0]).toBe('fake-agent')
    expect(target.setupState('setup')).toBeNull()
  })

  it('does not relaunch a killed setup or run it for an ordinary checkout', () => {
    const target = new PtyManager({ onData: vi.fn(), onExit: vi.fn() }, null, null, () => 'echo prepare')
    target.spawn({ id: 'ordinary', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 })
    expect(fake.spawn.mock.calls[0][0]).toBe('fake-agent')
    registerPendingWorktree(cwd, cwd)
    target.spawn({ id: 'setup', agent: 'codex', cwd, resume: false, cols: 80, rows: 24 })
    const setupExit = fake.exit
    target.kill('setup')
    setupExit?.({ exitCode: 0 })
    expect(fake.spawn).toHaveBeenCalledTimes(2)
    expect(target.resolveSetup('setup', 'start').ok).toBe(false)
    target.kill('ordinary')
  })
})

describe('PtyManager recording hooks', () => {
  let cwd: string

  beforeEach(() => {
    fake.data = null
    fake.exit = null
    cwd = mkdtempSync(join(tmpdir(), 'dawsha-pty-recording-'))
  })

  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  const fakeRecorder = () => ({
    start: vi.fn(),
    output: vi.fn(),
    resize: vi.fn(),
    input: vi.fn(),
    stop: vi.fn()
  })
  const manager = (recorder: ReturnType<typeof fakeRecorder>, remote: RemoteTerminalState | null = null) =>
    new PtyManager({ onData: vi.fn(), onExit: vi.fn() }, remote, { recorder: recorder as unknown as Recorder, projectName: () => 'Billing' })

  it('starts one recording per spawn with the project name, title and size, and feeds output, resize, input and exit', () => {
    const recorder = fakeRecorder()
    const target = manager(recorder)
    target.spawn({ id: 't1', projectId: 'p1', agent: 'claude', cwd, resume: false, cols: 90, rows: 30, title: 'Add retry' })
    expect(recorder.start).toHaveBeenCalledTimes(1)
    expect(recorder.start).toHaveBeenCalledWith('t1', { projectId: 'p1', projectName: 'Billing', agent: 'claude', title: 'Add retry', cwd }, { cols: 90, rows: 30 })

    fake.data?.('out')
    expect(recorder.output).toHaveBeenCalledWith('t1', 'out')
    target.resize('t1', 100, 40)
    expect(recorder.resize).toHaveBeenCalledWith('t1', 100, 40)
    target.write('t1', 'hello\r')
    expect(recorder.input).toHaveBeenCalledWith('t1', 'hello\r')
    fake.exit?.({ exitCode: 2 })
    expect(recorder.stop).toHaveBeenCalledWith('t1', 2)
  })

  it('records a remote-managed headless session exactly once, never through the remote mirror', () => {
    const recorder = fakeRecorder()
    const target = manager(recorder, new RemoteTerminalState())
    target.spawn({ id: 'r1', projectId: 'p1', agent: 'codex', cwd, resume: false, cols: 80, rows: 24, desktopVisible: false, remoteManaged: true })
    fake.data?.('mirrored')
    expect(recorder.start).toHaveBeenCalledTimes(1)
    expect(recorder.output).toHaveBeenCalledTimes(1)
  })

  it('stops the recording when the pane is killed', () => {
    const recorder = fakeRecorder()
    const target = manager(recorder)
    target.spawn({ id: 't1', projectId: 'p1', agent: 'claude', cwd, resume: false, cols: 80, rows: 24 })
    target.kill('t1')
    expect(recorder.stop).toHaveBeenCalledWith('t1')
  })

  it('gives a Lead pane its goal in DAWSHA_CREW_GOAL, and no other pane one', () => {
    fake.spawn.mockClear()
    const target = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    target.spawn({ id: 'lead', projectId: 'p1', agent: 'claude', cwd, resume: false, cols: 80, rows: 24, crew: crewLaunch({ goal: 'g7' }) })
    target.spawn({ id: 'member', projectId: 'p1', agent: 'claude', cwd, resume: false, cols: 80, rows: 24, crew: crewLaunch({}) })
    const [[, , leadOptions], [, , memberOptions]] = fake.spawn.mock.calls as Array<[string, unknown, { env: Record<string, string> }]>
    expect(leadOptions.env.DAWSHA_CREW_GOAL).toBe('g7')
    expect(memberOptions.env.DAWSHA_CREW_GOAL).toBeUndefined()
  })

  it('works without a recorder', () => {
    const target = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    expect(target.spawn({ id: 't1', projectId: 'p1', agent: 'claude', cwd, resume: false, cols: 80, rows: 24 }).ok).toBe(true)
  })
})
