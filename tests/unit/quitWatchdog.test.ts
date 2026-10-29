import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { startQuitWatchdog } from '../../src/main/quitWatchdog'

function exitOf(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

async function liveProcess(): Promise<ReturnType<typeof spawn>> {
  const child = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  await once(child.stdout!, 'data')
  return child
}

describe('quit watchdog', () => {
  it.runIf(process.platform === 'win32')('keeps guarding after its owning Node environment exits', async () => {
    const child = await liveProcess()
    const gone = exitOf(child)
    const logPath = join(mkdtempSync(join(tmpdir(), 'dawsha-wd-native-')), 'quit.log')
    const moduleUrl = pathToFileURL(resolve(__dirname, '../../src/main/quitWatchdog.ts')).href
    const owner = new Worker(`import(${JSON.stringify(moduleUrl)}).then(({ startQuitWatchdog }) => startQuitWatchdog(${JSON.stringify({ ms: 500, pid: child.pid, logPath })}))`, { eval: true })
    const ownerGone = new Promise<number>((resolve, reject) => {
      owner.once('exit', resolve)
      owner.once('error', reject)
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      expect(await ownerGone).toBe(0)
      expect(child.exitCode).toBeNull()
      await Promise.race([gone, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('watchdog stopped with its owner')), 8000) })])
      expect(readFileSync(logPath, 'utf8')).toContain('watchdog: pid')
    } finally {
      clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await owner.terminate()
      await Promise.all([gone, ownerGone])
    }
  })

  it('kills the target process when it is still alive after the deadline and logs why', async () => {
    const child = await liveProcess()
    const gone = exitOf(child)
    const logPath = join(mkdtempSync(join(tmpdir(), 'dawsha-wd-')), 'quit.log')
    const stop = startQuitWatchdog({ ms: 300, pid: child.pid, logPath })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([gone, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('not killed')), 8000) })])
      expect(readFileSync(logPath, 'utf8')).toContain('watchdog: pid')
    } finally {
      clearTimeout(timer)
      stop()
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await gone
    }
  })

  it('does nothing when it is stopped before the deadline', async () => {
    const child = await liveProcess()
    const gone = exitOf(child)
    const stop = startQuitWatchdog({ ms: 300, pid: child.pid })
    try {
      stop()
      await new Promise((resolve) => setTimeout(resolve, 900))
      expect(child.exitCode).toBeNull()
    } finally {
      child.kill()
      await gone
    }
  })
})
