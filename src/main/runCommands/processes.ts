import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type {
  RunCommand,
  RunSnapshot,
  RunTarget
} from '../../shared/runCommands'
import { platformExecutableDirs, resolveExecutable } from '../executables'

interface RunChild {
  pid?: number
  stdout: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  } | null
  stderr: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  } | null
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
}
interface LaunchSpec {
  file: string
  args: string[]
  env?: NodeJS.ProcessEnv
  shell?: string
}
export interface RunProcessDependencies {
  spawn(file: string, args: string[], options: SpawnOptions): RunChild
  kill(pid: number): Promise<void>
  prepare(command: RunCommand): LaunchSpec
  platform: NodeJS.Platform
}

export function prepareRunCommand(command: RunCommand): LaunchSpec {
  if (command.shellCommand) {
    return {
      file: command.shellCommand,
      args: [],
      shell:
        process.platform === 'win32'
          ? (process.env.ComSpec ?? 'cmd.exe')
          : (process.env.SHELL ?? '/bin/sh')
    }
  }
  if (!command.executable || !command.args)
    throw new Error('Run command is unavailable. Detect commands again.')
  const file = resolveExecutable(command.executable, platformExecutableDirs())
  if (!file)
    throw new Error(
      `${command.executable} is not installed or is unavailable on PATH. Edit the command or install the tool yourself.`
    )
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(file))
    return { file, args: command.args }
  // Windows cannot spawn .cmd without a shell. Use the installed JS entrypoint
  // directly so repository paths and launch arguments never enter cmd parsing.
  const base = dirname(file)
  const candidates: Record<string, string[]> = {
    npm: [join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js')],
    pnpm: [
      join(base, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
      join(base, 'node_modules', 'pnpm', 'bin', 'pnpm.js')
    ],
    yarn: [
      join(base, 'node_modules', 'yarn', 'bin', 'yarn.js'),
      join(base, '..', 'lib', 'cli.js')
    ]
  }
  const script = candidates[command.executable]?.find((path) =>
    existsSync(path)
  )
  if (!script)
    throw new Error(
      `Cannot launch this ${command.executable} shim safely. Save an explicit custom shell command or use a native installation.`
    )
  const node = resolveExecutable('node', platformExecutableDirs())
  const nativeNode =
    node && extname(node).toLowerCase() === '.exe' ? node : process.execPath
  return {
    file: nativeNode,
    args: [script, ...command.args],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
}

async function killRunTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error('Run has no process to stop.')
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const child = nodeSpawn(
        join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'taskkill.exe'
        ),
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', shell: false }
      )
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('Stopping the run process tree timed out.'))
      }, 5000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        code === 0
          ? resolve()
          : reject(new Error('Could not stop the run process tree.'))
      })
    })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}

export class RunProcesses {
  private readonly runs = new Map<
    string,
    { snapshot: RunSnapshot; child: RunChild; stopping?: Promise<void> }
  >()
  private closed = false
  private publishTimer: ReturnType<typeof setTimeout> | undefined
  private readonly dependencies: RunProcessDependencies
  constructor(
    private readonly changed: (runs: RunSnapshot[]) => void,
    dependencies: Partial<RunProcessDependencies> = {}
  ) {
    this.dependencies = {
      spawn: nodeSpawn,
      kill: killRunTree,
      prepare: prepareRunCommand,
      platform: process.platform,
      ...dependencies
    }
  }
  list(): RunSnapshot[] {
    return [...this.runs.values()].map((run) => ({ ...run.snapshot }))
  }
  private publish(immediate = false): void {
    if (this.closed) return
    if (immediate) {
      if (this.publishTimer) clearTimeout(this.publishTimer)
      this.publishTimer = undefined
      this.changed(this.list())
      return
    }
    if (!this.publishTimer)
      this.publishTimer = setTimeout(() => {
        this.publishTimer = undefined
        if (!this.closed) this.changed(this.list())
      }, 60)
  }
  start(target: RunTarget, command: RunCommand, cwd: string): RunSnapshot {
    if (this.closed) throw new Error('Run manager is closed.')
    const active = [...this.runs.values()].filter(
      (r) => r.snapshot.status === 'running' || r.snapshot.status === 'stopping'
    )
    if (
      active.some(
        (r) =>
          r.snapshot.folder === target.folder &&
          r.snapshot.commandId === command.id
      )
    )
      throw new Error(
        'This command is already running in this checkout. Stop it before running again.'
      )
    if (active.length >= 8)
      throw new Error(
        'Eight commands are already running. Stop a command first.'
      )
    const launch = this.dependencies.prepare(command)
    const child = this.dependencies.spawn(launch.file, launch.args, {
      cwd,
      env: launch.env ?? process.env,
      windowsHide: true,
      detached: this.dependencies.platform !== 'win32',
      shell: launch.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const snapshot: RunSnapshot = {
      id: randomUUID(),
      commandId: command.id,
      name: command.name,
      projectId: target.projectId,
      folder: target.folder,
      cwd,
      display: command.display,
      status: 'running',
      output: '',
      exitCode: null,
      startedAt: Date.now()
    }
    this.runs.set(snapshot.id, { snapshot, child })
    for (const [id, old] of this.runs) {
      if (this.runs.size <= 24) break
      if (
        old.snapshot.status !== 'running' &&
        old.snapshot.status !== 'stopping'
      )
        this.runs.delete(id)
    }
    const append = (text: string): void => {
      snapshot.output = (snapshot.output + text).slice(-200000)
      this.publish()
    }
    const stdout = new StringDecoder('utf8'),
      stderr = new StringDecoder('utf8')
    child.stdout?.on('data', (chunk) => append(stdout.write(chunk)))
    child.stderr?.on('data', (chunk) => append(stderr.write(chunk)))
    child.on('error', (error) => {
      snapshot.status = 'failed'
      append(`\nRun failed: ${error.message}\n`)
      this.publish(true)
    })
    child.on('close', (code) => {
      append(stdout.end() + stderr.end())
      // Preserve spawn failures even if close reports a null exit code.
      snapshot.status =
        snapshot.status === 'stopping'
          ? 'stopped'
          : snapshot.status === 'failed'
            ? 'failed'
            : code === 0
              ? 'exited'
              : 'failed'
      snapshot.exitCode = code
      this.publish(true)
    })
    this.publish(true)
    return { ...snapshot }
  }
  async stop(id: string): Promise<void> {
    const run = this.runs.get(id)
    if (
      !run ||
      (run.snapshot.status !== 'running' && run.snapshot.status !== 'stopping')
    )
      return
    if (run.stopping) return run.stopping
    if (!run.child.pid) throw new Error('Run has no process to stop.')
    run.snapshot.status = 'stopping'
    this.publish(true)
    try {
      run.stopping = this.dependencies.kill(run.child.pid)
      await run.stopping
    } catch (error) {
      run.stopping = undefined
      if (run.snapshot.status === 'stopping') run.snapshot.status = 'running'
      run.snapshot.output = (
        run.snapshot.output + '\nCould not stop this run. Try Stop again.\n'
      ).slice(-200000)
      this.publish(true)
      throw error
    }
  }
  async dispose(): Promise<void> {
    this.closed = true
    if (this.publishTimer) clearTimeout(this.publishTimer)
    await Promise.allSettled(
      [...this.runs.values()]
        .filter(
          (run) =>
            (run.snapshot.status === 'running' ||
              run.snapshot.status === 'stopping') &&
            run.child.pid
        )
        .map((run) => this.stop(run.snapshot.id))
    )
  }
}
