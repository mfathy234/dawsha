import { Worker } from 'node:worker_threads'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const BEAT_MS = 250

const WORKER_SOURCE = `
const { workerData } = require('node:worker_threads')
const { appendFileSync } = require('node:fs')
const beat = new Float64Array(workerData.shared)
setTimeout(() => {
  const silent = Date.now() - beat[0]
  if (workerData.logPath) {
    try {
      appendFileSync(
        workerData.logPath,
        new Date().toISOString() + ' watchdog: pid ' + workerData.pid + ' still alive after ' + workerData.ms +
          'ms, main thread silent for ' + silent + 'ms, killing it' + String.fromCharCode(10)
      )
    } catch {}
  }
  process.kill(workerData.pid, 'SIGKILL')
}, workerData.ms)
`

export interface QuitWatchdogOptions {
  ms: number
  pid?: number
  logPath?: string
}

// A Node worker stops before Electron finishes native teardown on Windows.
// Hold an OS process handle so the guard survives that teardown and PID reuse.
const WINDOWS_SOURCE = `
$ErrorActionPreference = 'Stop'
$watchTarget = $null
try {
  $watchTarget = [Diagnostics.Process]::GetProcessById([int]$env:DAWSHA_WATCHDOG_PID)
  $watchHandle = $watchTarget.Handle
  if ([DateTimeOffset]$watchTarget.StartTime.ToUniversalTime() -gt [DateTimeOffset]::FromUnixTimeMilliseconds([long]$env:DAWSHA_WATCHDOG_ARMED)) {
    return
  }
  $remaining = [Math]::Max(0, [long]$env:DAWSHA_WATCHDOG_DEADLINE - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  if (-not $watchTarget.WaitForExit([int]$remaining)) {
    if ($env:DAWSHA_WATCHDOG_LOG) {
      try {
        [IO.File]::AppendAllText($env:DAWSHA_WATCHDOG_LOG, [DateTime]::UtcNow.ToString('o') +
          ' watchdog: pid ' + $env:DAWSHA_WATCHDOG_PID + ' still alive after ' + $env:DAWSHA_WATCHDOG_MS + 'ms, killing it' + [char]10)
      } catch {}
    }
    & taskkill.exe /PID $env:DAWSHA_WATCHDOG_PID /T /F *> $null
    if (-not $watchTarget.HasExited) { $watchTarget.Kill() }
  }
} catch {} finally {
  if ($watchTarget) { $watchTarget.Dispose() }
}
`

function startWindowsWatchdog(options: QuitWatchdogOptions): () => void {
  const armedAt = Date.now()
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const watcher = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_SOURCE, 'utf16le').toString('base64')], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      DAWSHA_WATCHDOG_PID: String(options.pid ?? process.pid),
      DAWSHA_WATCHDOG_ARMED: String(armedAt),
      DAWSHA_WATCHDOG_DEADLINE: String(armedAt + options.ms),
      DAWSHA_WATCHDOG_MS: String(options.ms),
      DAWSHA_WATCHDOG_LOG: options.logPath ?? process.env.DAWSHA_QUIT_LOG ?? ''
    }
  })
  watcher.on('error', () => undefined)
  watcher.unref()
  return () => { watcher.kill() }
}

export function startQuitWatchdog(options: QuitWatchdogOptions): () => void {
  if (process.platform === 'win32') return startWindowsWatchdog(options)
  const shared = new SharedArrayBuffer(8)
  const beat = new Float64Array(shared)
  beat[0] = Date.now()
  const timer = setInterval(() => {
    beat[0] = Date.now()
  }, BEAT_MS)
  timer.unref()
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { shared, ms: options.ms, pid: options.pid ?? process.pid, logPath: options.logPath ?? process.env.DAWSHA_QUIT_LOG }
  })
  worker.unref()
  worker.on('error', () => undefined)
  return () => {
    clearInterval(timer)
    void worker.terminate()
  }
}
