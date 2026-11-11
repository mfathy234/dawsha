import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { RunCommand } from '../shared/runCommands'
import { failureCounts, failureExcerpt, OUTPUT_KEEP, type CheckResult, type CheckRunUpdate } from '../shared/turnChecks'
import { killRunTree, prepareRunCommand } from './runCommands/processes'

const CHECK_TIMEOUT_MS = 10 * 60_000

interface Child {
  pid?: number
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown } | null
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown } | null
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
}

export interface RunnerDeps {
  /** The commands to run for these ids, in the order asked, with the folder each runs in. */
  resolve(folder: string, projectId: string, ids: readonly string[]): Promise<Array<{ command: RunCommand; cwd: string }>>
  spawn(file: string, args: string[], options: SpawnOptions): Child
  kill(pid: number): Promise<void>
  prepare: typeof prepareRunCommand
  now(): number
}

interface Active {
  runId: string
  stopped: boolean
  pid: number | undefined
}

const blank = (command: RunCommand): CheckResult => ({ commandId: command.id, display: command.display, status: 'queued', exitCode: null, seconds: 0, counts: '', excerpt: '', output: '' })

/** Runs a project's checks one after another in a session's folder; one run per session at a time. */
export class TurnChecksRunner {
  private readonly active = new Map<string, Active>()
  private readonly deps: RunnerDeps

  constructor(private readonly publish: (update: CheckRunUpdate) => void, deps: Pick<RunnerDeps, 'resolve'> & Partial<RunnerDeps>) {
    this.deps = { spawn: nodeSpawn, kill: killRunTree, prepare: prepareRunCommand, now: Date.now, ...deps }
  }

  async start(folder: string, projectId: string, sessionId: string, ids: readonly string[]): Promise<string> {
    await this.stop(sessionId)
    const planned = await this.deps.resolve(folder, projectId, ids)
    if (planned.length === 0) throw new Error('None of the chosen commands is available in this folder.')
    const run: Active = { runId: randomUUID(), stopped: false, pid: undefined }
    this.active.set(sessionId, run)
    const results = planned.map((entry) => blank(entry.command))
    this.emit(sessionId, run, results, false)
    void this.sequence(sessionId, run, planned, results)
    return run.runId
  }

  async stop(sessionId: string): Promise<void> {
    const run = this.active.get(sessionId)
    if (!run) return
    run.stopped = true
    this.active.delete(sessionId)
    if (run.pid) await this.deps.kill(run.pid).catch(() => undefined)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)))
  }

  private emit(sessionId: string, run: Active, results: readonly CheckResult[], done: boolean): void {
    if (!run.stopped) this.publish({ runId: run.runId, sessionId, results: results.map((result) => ({ ...result })), done })
  }

  private async sequence(sessionId: string, run: Active, planned: Array<{ command: RunCommand; cwd: string }>, results: CheckResult[]): Promise<void> {
    for (let index = 0; index < planned.length && !run.stopped; index += 1) {
      results[index] = { ...results[index], status: 'running' }
      this.emit(sessionId, run, results, false)
      results[index] = await this.one(run, planned[index].command, planned[index].cwd)
      this.emit(sessionId, run, results, index === planned.length - 1)
    }
    if (this.active.get(sessionId) === run) this.active.delete(sessionId)
  }

  private one(run: Active, command: RunCommand, cwd: string): Promise<CheckResult> {
    const started = this.deps.now()
    const base = blank(command)
    return new Promise((resolve) => {
      let output = ''
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (code: number | null, extra = ''): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        run.pid = undefined
        const text = (output + extra).slice(-OUTPUT_KEEP)
        const passed = code === 0
        resolve({
          ...base,
          status: passed ? 'passed' : 'failed',
          exitCode: code,
          seconds: (this.deps.now() - started) / 1000,
          counts: passed ? '' : failureCounts(text),
          excerpt: passed ? '' : failureExcerpt(text),
          output: text
        })
      }
      try {
        const launch = this.deps.prepare(command)
        const child = this.deps.spawn(launch.file, launch.args, {
          cwd,
          env: launch.env ?? process.env,
          windowsHide: true,
          detached: process.platform !== 'win32',
          shell: launch.shell ?? false,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        run.pid = child.pid
        const out = new StringDecoder('utf8')
        const err = new StringDecoder('utf8')
        const append = (text: string): void => {
          output = (output + text).slice(-OUTPUT_KEEP * 2)
        }
        child.stdout?.on('data', (chunk) => append(out.write(chunk)))
        child.stderr?.on('data', (chunk) => append(err.write(chunk)))
        child.on('error', (error) => finish(null, `\nCould not run: ${error.message}\n`))
        child.on('close', (code) => finish(code ?? 1, out.end() + err.end()))
        timer = setTimeout(() => {
          if (child.pid) void this.deps.kill(child.pid).catch(() => undefined)
          finish(null, '\nStopped after 10 minutes.\n')
        }, CHECK_TIMEOUT_MS)
      } catch (error) {
        finish(null, `Could not run: ${(error as Error).message}\n`)
      }
    })
  }
}
