import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter } from 'node:path'
import * as pty from 'node-pty'
import { claudeCommand, codexCommand, geminiCommand, launchSpec, shellCommand } from './agentLaunch'
import { ptyArguments } from './commandLine'
import { platformExecutableDirs } from './executables'
import type { QuitLog } from './quitLog'
import type { Recorder } from './recorder'
import type { AppInfo, SpawnRequest, SpawnResult } from '../shared/types'
import type { ProcessRoot } from '../shared/processActivity'
import type { RemoteTerminalFrame, RemoteTerminalScreen, RemoteTerminalSnapshot } from './remoteTerminalState'

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
}

interface Entry {
  process: pty.IPty
  startedAt: number
  buffer: string
  timer: NodeJS.Timeout | null
  killed: boolean
  desktopVisible: boolean
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
    private readonly recording: PtyRecording | null = null
  ) {
    this.remoteTerminals = remoteTerminals
  }

  info(userData: string): Omit<AppInfo, 'version'> {
    return { claudeCommand: claudeCommand(), codexCommand: codexCommand(), geminiCommand: geminiCommand(), shellCommand: shellCommand(), home: homedir(), userData }
  }

  activityRoots(): ProcessRoot[] {
    return [...this.entries].map(([tabId, entry]) => ({ tabId, pid: entry.process.pid, startedAt: entry.startedAt }))
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
    const spec = launchSpec(request)
    if (typeof spec === 'string') return { ok: false, error: spec }
    this.kill(request.id)
    try {
      const cols = Math.max(2, request.cols)
      const rows = Math.max(1, request.rows)
      const child = pty.spawn(spec.file, ptyArguments(spec.args), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: request.cwd,
        env: this.environment(request.crew?.goal)
      })
      this.attach(request.id, child, request.projectId ?? null, request.agent, request.desktopVisible !== false, request.remoteManaged === true, { cols, rows })
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
      return { ok: true, pid: child.pid }
    } catch (error) {
      return { ok: false, error: `Could not start ${spec.file}: ${(error as Error).message}` }
    }
  }

  write(id: string, data: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.process.write(data)
    this.recording?.recorder.input(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id)
    if (!entry || cols < 2 || rows < 1) return
    try {
      entry.process.resize(cols, rows)
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
    if (entry.timer) clearTimeout(entry.timer)
    killTree(entry.process)
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
      this.remoteTerminals?.remove(id)
      this.recording?.recorder.stop(id)
      if (entry.timer) clearTimeout(entry.timer)
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

  private attach(id: string, child: pty.IPty, projectId: string | null, agent: SpawnRequest['agent'], desktopVisible: boolean, remoteManaged: boolean, size: { cols: number; rows: number }): void {
    const startedAt = Date.now()
    const entry: Entry = { process: child, startedAt, buffer: '', timer: null, killed: false, desktopVisible }
    this.entries.set(id, entry)
    this.remoteTerminals?.add(id, startedAt, { projectId, agent, remoteManaged }, size)
    child.onData((data) => {
      if (entry.killed) return
      entry.buffer += data
      this.remoteTerminals?.append(id, data)
      this.recording?.recorder.output(id, data)
      if (entry.timer) return
      entry.timer = setTimeout(() => this.flush(id, entry), FLUSH_MS)
    })
    child.onExit(({ exitCode }) => {
      if (entry.killed) return
      this.flush(id, entry)
      this.entries.delete(id)
      this.remoteTerminals?.remove(id)
      this.recording?.recorder.stop(id, exitCode)
      if (entry.desktopVisible) this.handlers.onExit(id, exitCode)
    })
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
