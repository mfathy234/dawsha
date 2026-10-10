import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startQuitWatchdog } from '../../src/main/quitWatchdog'

function exitOf(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

describe('quit watchdog', () => {
  it('kills the target process when it is still alive after the deadline and logs why', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const gone = exitOf(child)
    const logPath = join(mkdtempSync(join(tmpdir(), 'dawsha-wd-')), 'quit.log')
    const stop = startQuitWatchdog({ ms: 300, pid: child.pid, logPath })
    await Promise.race([gone, new Promise((_, reject) => setTimeout(() => reject(new Error('not killed')), 8000))])
    stop()
    expect(readFileSync(logPath, 'utf8')).toContain('watchdog: pid')
  })

  it('does nothing when it is stopped before the deadline', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const gone = exitOf(child)
    const stop = startQuitWatchdog({ ms: 300, pid: child.pid })
    stop()
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(child.exitCode).toBeNull()
    child.kill()
    await gone
  })
})
