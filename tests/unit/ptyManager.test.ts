import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  data: null as null | ((data: string) => void),
  exit: null as null | ((event: { exitCode: number }) => void),
  spawn: vi.fn(),
  kill: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
    queueMicrotask(() => callback(null))
  }
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
  launchSpec: () => ({ file: 'fake-agent', args: [] })
}))

import { PtyManager } from '../../src/main/ptyManager'
import { RemoteTerminalState } from '../../src/main/remoteTerminalState'
import type { Recorder } from '../../src/main/recorder'

describe('PtyManager desktop output delivery', () => {
  let cwd: string

  beforeEach(() => {
    fake.data = null
    fake.exit = null
    fake.spawn.mockClear()
    fake.kill.mockClear()
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

  it('works without a recorder', () => {
    const target = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    expect(target.spawn({ id: 't1', projectId: 'p1', agent: 'claude', cwd, resume: false, cols: 80, rows: 24 }).ok).toBe(true)
  })
})
