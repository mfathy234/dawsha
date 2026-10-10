import { Worker } from 'node:worker_threads'

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

export function startQuitWatchdog(options: QuitWatchdogOptions): () => void {
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
