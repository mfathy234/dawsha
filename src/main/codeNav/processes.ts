import { spawn, type ChildProcess } from 'node:child_process'
import { killProcessTree } from '../childProcesses'

export class NavigationProcesses {
  private readonly children = new Set<() => void>()
  private stopped = false

  track(stop: () => void, onExit: (listener: () => void) => void): () => void {
    if (this.stopped) { stop(); throw new Error('Navigation is shutting down.') }
    this.children.add(stop)
    onExit(() => this.children.delete(stop))
    return stop
  }

  spawn(command: string, args: string[], cwd?: string): { child: ChildProcess; stop(): void } {
    if (this.stopped) throw new Error('Navigation is shutting down.')
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' })
    const stop = (): void => {
      if (!child.pid || child.exitCode !== null) return
      if (process.platform === 'win32') killProcessTree(child.pid, () => undefined)
      else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }
    this.track(stop, listener => { child.once('exit', listener); child.once('error', listener) })
    return { child, stop }
  }

  run(command: string, args: string[], timeout = 5000): Promise<{ ok: boolean; stdout: string; error: string }> {
    return new Promise(resolve => {
      const { child, stop } = this.spawn(command, args)
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        stop()
        resolve({ ok: false, stdout, error: 'The command timed out.' })
      }, timeout)
      const append = (current: string, data: Buffer): string => (current + data.toString('utf8')).slice(-16 * 1024)
      child.stdout?.on('data', data => { stdout = append(stdout, data) })
      child.stderr?.on('data', data => { stderr = append(stderr, data) })
      child.stdin?.end()
      child.once('error', () => { clearTimeout(timer); resolve({ ok: false, stdout: '', error: 'Could not start dotnet.' }) })
      child.once('exit', code => {
        clearTimeout(timer)
        resolve({ ok: code === 0, stdout, error: stderr.trim().split(/\r?\n/)[0] || 'The command failed or timed out.' })
      })
    })
  }

  stop(): void {
    this.stopped = true
    for (const stop of this.children) stop()
    this.children.clear()
  }
}
