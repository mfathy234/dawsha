import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter } from 'node:path'
import * as pty from 'node-pty'
import { claudeCommand, codexCommand, geminiCommand, launchSpec, shellCommand } from './agentLaunch'
import { ptyArguments } from './commandLine'
import { platformExecutableDirs } from './executables'
import type { QuitLog } from './quitLog'
import type { AppInfo, SpawnRequest, SpawnResult } from '../shared/types'
import type { ProcessRoot } from '../shared/processActivity'

const FLUSH_MS = 8

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

  constructor(private readonly handlers: PtyHandlers) {}

  info(userData: string): Omit<AppInfo, 'version'> {
    return { claudeCommand: claudeCommand(), codexCommand: codexCommand(), geminiCommand: geminiCommand(), shellCommand: shellCommand(), home: homedir(), userData }
  }

  activityRoots(): ProcessRoot[] {
    return [...this.entries].map(([tabId, entry]) => ({ tabId, pid: entry.process.pid, startedAt: entry.startedAt }))
  }

  spawn(request: SpawnRequest): SpawnResult {
    const problem = folderProblem(request.cwd)
    if (problem) return { ok: false, error: problem }
    const spec = launchSpec(request)
    if (typeof spec === 'string') return { ok: false, error: spec }
    this.kill(request.id)
    try {
      const child = pty.spawn(spec.file, ptyArguments(spec.args), {
        name: 'xterm-256color',
        cols: Math.max(2, request.cols),
        rows: Math.max(1, request.rows),
        cwd: request.cwd,
        env: this.environment()
      })
      this.attach(request.id, child)
      return { ok: true, pid: child.pid }
    } catch (error) {
      return { ok: false, error: `Could not start ${spec.file}: ${(error as Error).message}` }
    }
  }

  write(id: string, data: string): void {
    this.entries.get(id)?.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id)
    if (!entry || cols < 2 || rows < 1) return
    try {
      entry.process.resize(cols, rows)
    } catch {
      return
    }
  }

  kill(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    entry.killed = true
    if (entry.timer) clearTimeout(entry.timer)
    killTree(entry.process)
  }

  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id)
  }

  async terminateAll(timeoutMs: number, log: QuitLog = () => undefined): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    const trees = entries.map((entry) => {
      entry.killed = true
      if (entry.timer) clearTimeout(entry.timer)
      if (process.platform === 'win32') return taskkillTree(entry.process.pid, log)
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

  private environment(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
    }
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    if (process.platform === 'darwin') {
      env.PATH = [...new Set([...(env.PATH ?? '').split(delimiter).filter(Boolean), ...platformExecutableDirs()])].join(delimiter)
    }
    return env
  }

  private attach(id: string, child: pty.IPty): void {
    const entry: Entry = { process: child, startedAt: Date.now(), buffer: '', timer: null, killed: false }
    this.entries.set(id, entry)
    child.onData((data) => {
      if (entry.killed) return
      entry.buffer += data
      if (entry.timer) return
      entry.timer = setTimeout(() => this.flush(id, entry), FLUSH_MS)
    })
    child.onExit(({ exitCode }) => {
      if (entry.killed) return
      this.flush(id, entry)
      this.entries.delete(id)
      this.handlers.onExit(id, exitCode)
    })
  }

  private flush(id: string, entry: Entry): void {
    entry.timer = null
    if (!entry.buffer) return
    const data = entry.buffer
    entry.buffer = ''
    this.handlers.onData(id, data)
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
