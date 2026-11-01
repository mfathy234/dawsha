import { EventEmitter } from 'node:events'
import { existsSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork } }))
import { startTsServer } from '../../src/main/codeNav/utility'
import { NavigationProcesses } from '../../src/main/codeNav/processes'

const directories: string[] = []
const managers: NavigationProcesses[] = []
afterEach(() => {
  managers.splice(0).forEach(manager => manager.stop())
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }))
  fork.mockReset()
})

function child(): EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { pid: 123, kill: vi.fn(), postMessage: vi.fn() })
}

it('removes the wrapper directory on shutdown even before the utility exit event arrives', async () => {
  const utility = child()
  fork.mockImplementation((script: string) => { directories.push(dirname(script)); return utility })
  const manager = new NavigationProcesses()
  managers.push(manager)
  const client = startTsServer(process.cwd(), manager)
  utility.emit('message', { type: 'response', request_seq: 1, success: true })
  await client.ready
  expect(existsSync(directories[0])).toBe(true)
  manager.stop()
  expect(utility.kill).toHaveBeenCalled()
  expect(existsSync(directories[0])).toBe(false)
  utility.emit('exit', 0)
})

it('removes the wrapper directory when the process cannot start', async () => {
  const utility = child()
  fork.mockImplementation((script: string) => { directories.push(dirname(script)); return utility })
  const manager = new NavigationProcesses()
  managers.push(manager)
  const client = startTsServer(process.cwd(), manager)
  utility.emit('error', new Error('cannot start utility'))
  await expect(client.ready).rejects.toThrow()
  expect(existsSync(directories[0])).toBe(false)
})
