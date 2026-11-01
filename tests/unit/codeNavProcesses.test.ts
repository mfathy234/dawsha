import { once } from 'node:events'
import { expect, it } from 'vitest'
import { NavigationProcesses } from '../../src/main/codeNav/processes'

it('kills servers and their descendants on shutdown and refuses later starts', async () => {
  const processes = new NavigationProcesses()
  const script = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, shell: false }); process.stdout.write(String(child.pid)); setInterval(() => {}, 1000)`
  const { child } = processes.spawn(process.execPath, ['-e', script])
  const exit = once(child, 'exit')
  const [data] = await once(child.stdout!, 'data')
  const descendant = Number(data.toString())
  expect(descendant).toBeGreaterThan(0)
  processes.stop()
  await exit
  // A reaped descendant may take one scheduling turn to disappear on POSIX.
  await expect.poll(() => {
    try { process.kill(descendant, 0); return false } catch { return true }
  }).toBe(true)
  expect(() => processes.spawn(process.execPath, [])).toThrow(/shutting down/)
})

it('bounds failed commands and reports useful errors', async () => {
  const processes = new NavigationProcesses()
  try {
    expect(await processes.run(process.execPath, ['-e', "process.stderr.write('install failed'); process.exit(1)"])).toMatchObject({ ok: false, error: 'install failed' })
    expect(await processes.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 50)).toMatchObject({ ok: false })
  } finally { processes.stop() }
})
