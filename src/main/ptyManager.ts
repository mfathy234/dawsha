import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter } from 'node:path'
import * as pty from 'node-pty'
import { claudeCommand, codexCommand, geminiCommand, launchSpec, shellCommand, type LaunchSpec } from './agentLaunch'
import { ptyArguments } from './commandLine'
import { platformExecutableDirs } from './executables'
import type { QuitLog } from './quitLog'
import type { Recorder } from './recorder'
import type { AppInfo, SpawnRequest, SpawnResult } from '../shared/types'
import type { ProcessRoot } from '../shared/processActivity'
import type { RemoteTerminalFrame, RemoteTerminalScreen, RemoteTerminalSnapshot } from './remoteTerminalState'
import { claimPendingWorktree, completePendingWorktree, hasPendingWorktree, releasePendingWorktree, rememberPendingLaunch } from './worktreeSetupPending'
import type { TerminalSetupAction, TerminalSetupState } from '../shared/terminalSetup'
import { createSetupCommand, type SetupCommand } from './worktreeSetupCommand'
import { integratedShell } from './shellIntegration'

interface RemoteTerminalStateLike {
  snapshot(id?: string): RemoteTerminalSnapshot[]
  screen(id: string): Promise<RemoteTerminalScreen | null>
  tail(id: string): Promise<string | null>
  subscribe(id: string, listener: (frame: RemoteTerminalFrame) => void): (() => void) | null
  add(id: string, startedAt: number, metadata: { projectId: string | null; agent: SpawnRequest['agent']; remoteManaged?: boolean }, size: { cols: number; rows: number }): void
  append(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  remove(id: string): void
}

const FLUSH_MS = 8

export interface PtyRecording {
  recorder: Recorder
  projectName(projectId: string | null): string
}

export interface PtyHandlers {
  onData(id: string, data: string): void
  onExit(id: string, exitCode: number): void
  onSetup?(id: string, state: TerminalSetupState | null, pid?: number): void
}

interface SetupGate {
  request: SpawnRequest
  command: string
  agentSpec: LaunchSpec
  shell: SetupCommand
  state: TerminalSetupState
}

interface Entry {
  process: pty.IPty
  startedAt: number
  buffer: string
  timer: NodeJS.Timeout | null
  killed: boolean
  desktopVisible: boolean
  exited: boolean
  size: { cols: number; rows: number }
  setup: SetupGate | null
}

function folderProblem(cwd: string): string | null {
  try {
    return statSync(cwd).isDirectory() ? null : `Not a folder: ${cwd}`
  } catch {
    return `Folder not found: ${cwd}`
  }
}

export class PtyManager {
  private readonly entries = new Map<string, Entry>()
  private closing = false
  private readonly remoteTerminals: RemoteTerminalStateLike | null

  constructor(
    private readonly handlers: PtyHandlers,
    remoteTerminals: RemoteTerminalStateLike | null = null,
    private readonly recording: PtyRecording | null = null,
    private readonly setupCommand: (repo: string, projectId?: string) => string = () => ''
  ) {
    this.remoteTerminals = remoteTerminals
  }

  info(userData: string): Omit<AppInfo, 'version'> {
    return { claudeCommand: claudeCommand(), codexCommand: codexCommand(), geminiCommand: geminiCommand(), shellCommand: shellCommand(), home: homedir(), userData }
  }

  activityRoots(): ProcessRoot[] {
    return [...this.entries].filter(([, entry]) => !entry.exited).map(([tabId, entry]) => ({ tabId, pid: entry.process.pid, startedAt: entry.startedAt }))
  }

  remoteSnapshot(id?: string): RemoteTerminalSnapshot[] {
    return this.remoteTerminals?.snapshot(id) ?? []
  }

  remoteScreen(id: string): Promise<RemoteTerminalScreen | null> {
    return this.remoteTerminals?.screen(id) ?? Promise.resolve(null)
  }

  remoteTail(id: string): Promise<string | null> {
    return this.remoteTerminals?.tail(id) ?? Promise.resolve(null)
  }

  subscribeRemoteOutput(id: string, listener: (frame: RemoteTerminalFrame) => void): (() => void) | null {
    return this.remoteTerminals?.subscribe(id, listener) ?? null
  }

  spawn(request: SpawnRequest): SpawnResult {
    if (this.closing) return { ok: false, error: 'Dawsha is shutting down' }
    const problem = folderProblem(request.cwd)
    if (problem) return { ok: false, error: problem }
    this.kill(request.id)
    const pending = claimPendingWorktree(request.cwd)
    if (!pending && hasPendingWorktree(request.cwd)) return { ok: false, error: 'Worktree setup is waiting in another terminal. Finish it there first.' }
    if (pending?.launch?.agent === request.agent && !request.prompt && !request.initialInput) request = { ...request, ...pending.launch }
    const spec = launchSpec(request)
    if (typeof spec === 'string') {
      if (pending) releasePendingWorktree(request.cwd)
      return { ok: false, error: spec }
    }
    const repo = pending?.repo
    const command = repo ? this.setupCommand(repo, request.projectId).trim() : ''
    let setup: SetupGate | null = null
    if (command) {
      try {
        rememberPendingLaunch(request.cwd, { agent: request.agent, prompt: request.prompt, initialInput: request.initialInput, command: request.command, crew: request.crew, fullAccess: request.fullAccess })
        setup = { request: { ...request }, command, agentSpec: spec, shell: createSetupCommand(command), state: { phase: 'running' } }
      } catch (error) {
        if (repo) releasePendingWorktree(request.cwd)
        return { ok: false, error: `Could not prepare worktree setup: ${(error as Error).message}` }
      }
    }
    try {
      const cols = Math.max(2, request.cols)
      const rows = Math.max(1, request.rows)
      const env = this.environment(request.crew?.goal)
      const first = setup?.shell.spec ?? (request.agent === 'shell' && request.command === undefined ? integratedShell(spec, env) : spec)
      const child = pty.spawn(first.file, ptyArguments(first.args), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: request.cwd,
        env
      })
      this.attach(request.id, child, request.projectId ?? null, request.agent, request.desktopVisible !== false, request.remoteManaged === true, { cols, rows }, setup)
      this.recording?.recorder.start(
        request.id,
        {
          projectId: request.projectId ?? null,
          projectName: this.recording.projectName(request.projectId ?? null),
          agent: request.agent,
          title: request.title ?? '',
          cwd: request.cwd
        },
        { cols, rows }
      )
      if (setup) {
        this.output(request.id, this.entries.get(request.id)!, `\r\nWorktree setup: ${command}\r\n`)
        this.handlers.onSetup?.(request.id, setup.state, child.pid)
      } else {
        if (pending) completePendingWorktree(request.cwd)
        if (request.initialInput) child.write(request.initialInput)
      }
      return { ok: true, pid: child.pid }
    } catch (error) {
      setup?.shell.dispose()
      if (repo) releasePendingWorktree(request.cwd)
      return { ok: false, error: `Could not start ${spec.file}: ${(error as Error).message}` }
    }
  }

  write(id: string, data: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.exited) return
    entry.process.write(data)
    this.recording?.recorder.input(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id)
    if (!entry || cols < 2 || rows < 1 || (entry.size.cols === cols && entry.size.rows === rows)) return
    entry.size = { cols, rows }
    try {
      if (!entry.exited) entry.process.resize(cols, rows)
    } catch {
      return
    }
    this.remoteTerminals?.resize(id, cols, rows)
    this.recording?.recorder.resize(id, cols, rows)
  }

  kill(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.remoteTerminals?.remove(id)
    this.recording?.recorder.stop(id)
    entry.killed = true
    entry.setup?.shell.dispose()
    if (entry.setup) releasePendingWorktree(entry.setup.request.cwd)
    if (entry.timer) clearTimeout(entry.timer)
    if (!entry.exited) killTree(entry.process)
  }

  setupState(id: string): TerminalSetupState | null {
    return this.entries.get(id)?.setup?.state ?? null
  }

  resolveSetup(id: string, action: TerminalSetupAction): SpawnResult {
    if (this.closing) return { ok: false, error: 'Dawsha is shutting down' }
    const entry = this.entries.get(id)
    if (!entry?.setup || entry.setup.state.phase !== 'failed') return { ok: false, error: 'This session has no failed worktree setup.' }
    return this.advanceSetup(id, entry, action === 'retry')
  }

  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id)
  }

  async terminateAll(timeoutMs: number, log: QuitLog = () => undefined): Promise<void> {
    this.closing = true
    const entries = [...this.entries.entries()]
    this.entries.clear()
    const trees = entries.map(([id, entry]) => {
      entry.killed = true
      entry.setup?.shell.dispose()
      this.remoteTerminals?.remove(id)
      this.recording?.recorder.stop(id)
      if (entry.timer) clearTimeout(entry.timer)
      if (entry.exited) return Promise.resolve()
      if (process.platform === 'win32') return taskkillTree(entry.process.pid, log).then(() => {
        // Dispose ConPTY only after taskkill has found the shell and its children.
        try { entry.process.kill() } catch (error) {
          log(`pty dispose failed pid=${entry.process.pid}: ${(error as Error).message}`)
        }
      })
      killPosixTree(entry.process.pid)
      return Promise.resolve()
    })
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
    log(`terminateAll: killing ${trees.length} pty tree(s)`)
    await Promise.race([Promise.all(trees), deadline])
    clearTimeout(timer)
  }

  private environment(leadGoal?: string): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
    }
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    if (leadGoal) env.DAWSHA_CREW_GOAL = leadGoal
    else delete env.DAWSHA_CREW_GOAL
    if (process.platform === 'darwin') {
      env.PATH = [...new Set([...(env.PATH ?? '').split(delimiter).filter(Boolean), ...platformExecutableDirs()])].join(delimiter)
    }
    return env
  }

  private attach(id: string, child: pty.IPty, projectId: string | null, agent: SpawnRequest['agent'], desktopVisible: boolean, remoteManaged: boolean, size: { cols: number; rows: number }, setup: SetupGate | null): void {
    const startedAt = Date.now()
    const entry: Entry = { process: child, startedAt, buffer: '', timer: null, killed: false, desktopVisible, exited: false, size, setup }
    this.entries.set(id, entry)
    this.remoteTerminals?.add(id, startedAt, { projectId, agent, remoteManaged }, size)
    this.connect(id, entry, child)
  }

  private output(id: string, entry: Entry, data: string): void {
    entry.buffer += data
    this.remoteTerminals?.append(id, data)
    this.recording?.recorder.output(id, data)
    if (!entry.timer) entry.timer = setTimeout(() => this.flush(id, entry), FLUSH_MS)
  }

  private connect(id: string, entry: Entry, child: pty.IPty): void {
    child.onData((data) => {
      if (entry.killed || entry.process !== child) return
      this.output(id, entry, data)
    })
    child.onExit(({ exitCode }) => {
      if (entry.killed || entry.process !== child) return
      entry.exited = true
      this.flush(id, entry)
      if (entry.setup) {
        if (exitCode === 0) this.advanceSetup(id, entry, false)
        else this.failSetup(id, entry, exitCode)
        return
      }
      this.entries.delete(id)
      this.remoteTerminals?.remove(id)
      this.recording?.recorder.stop(id, exitCode)
      if (entry.desktopVisible) this.handlers.onExit(id, exitCode)
    })
  }

  private failSetup(id: string, entry: Entry, exitCode: number, message?: string): void {
    if (!entry.setup) return
    entry.setup.state = { phase: 'failed', exitCode }
    this.output(id, entry, `\r\nWorktree setup failed (exit ${exitCode}).${message ? ` ${message}` : ''}\r\nChoose Retry or Start the agent anyway.\r\n`)
    this.handlers.onSetup?.(id, entry.setup.state)
  }

  private advanceSetup(id: string, entry: Entry, retry: boolean): SpawnResult {
    const setup = entry.setup!
    const env = this.environment(setup.request.crew?.goal)
    const spec = retry ? setup.shell.spec : setup.request.agent === 'shell' && setup.request.command === undefined ? integratedShell(setup.agentSpec, env) : setup.agentSpec
    try {
      const child = pty.spawn(spec.file, ptyArguments(spec.args), {
        name: 'xterm-256color', ...entry.size, cwd: setup.request.cwd, env
      })
      entry.process = child
      entry.exited = false
      entry.startedAt = Date.now()
      if (retry) setup.state = { phase: 'running' }
      else {
        entry.setup = null
        setup.shell.dispose()
        completePendingWorktree(setup.request.cwd)
      }
      this.connect(id, entry, child)
      this.output(id, entry, retry ? `\r\nRetrying worktree setup: ${setup.command}\r\n` : '\r\nStarting the agent.\r\n')
      this.handlers.onSetup?.(id, entry.setup?.state ?? null, child.pid)
      if (!retry && setup.request.initialInput) child.write(setup.request.initialInput)
      return { ok: true, pid: child.pid }
    } catch (error) {
      this.failSetup(id, entry, -1, `Could not start ${spec.file}: ${(error as Error).message}`)
      return { ok: false, error: `Could not start ${spec.file}: ${(error as Error).message}` }
    }
  }

  private flush(id: string, entry: Entry): void {
    entry.timer = null
    if (!entry.buffer) return
    const data = entry.buffer
    entry.buffer = ''
    if (entry.desktopVisible) this.handlers.onData(id, data)
  }
}

function taskkillTree(pid: number, log: QuitLog = () => undefined): Promise<void> {
  log(`taskkill start pid=${pid}`)
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 3000 }, (error) => {
      const code = error ? ((error as NodeJS.ErrnoException).code ?? error.message) : 0
      log(`taskkill end pid=${pid} exit=${String(code)}`)
      resolve()
    })
  })
}

function killTree(child: pty.IPty): void {
  if (process.platform !== 'win32') {
    killPosixTree(child.pid)
    return
  }
  void taskkillTree(child.pid).then(() => {
    try {
      child.kill()
    } catch {
      return
    }
  })
}

function killPosixTree(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try { process.kill(pid, 'SIGTERM') } catch { return }
  }
  const forceKill = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try { process.kill(pid, 'SIGKILL') } catch { return }
    }
  }, 1500)
  forceKill.unref()
}
