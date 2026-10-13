import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  data: null as null | ((data: string) => void),
  exit: null as null | ((event: { exitCode: number }) => void),
  spawn: vi.fn()
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
      kill: vi.fn()
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

describe('PtyManager desktop output delivery', () => {
  let cwd: string

  beforeEach(() => {
    fake.data = null
    fake.exit = null
    fake.spawn.mockClear()
    cwd = mkdtempSync(join(tmpdir(), 'dawsha-pty-manager-'))
  })

  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

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
