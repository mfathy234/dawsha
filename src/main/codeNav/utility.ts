import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utilityProcess } from 'electron'
import { TsServerClient } from './tsserver'
import type { NavigationProcesses } from './processes'

// Utility processes have message ports but no stdin or Node IPC channel.
export const TSSERVER_UTILITY_SOURCE = `
process.send = message => { process.parentPort.postMessage(message); return true }
process.parentPort.on('message', event => process.emit('message', event.data))
require(process.argv[2])
`

export function tsserverModulePath(): string {
  // tsserver disables ASAR support itself; its libraries must be physical files too.
  return require.resolve('typescript/lib/tsserver.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

export function startTsServer(folder: string, processes: NavigationProcesses): TsServerClient {
  const directory = mkdtempSync(join(tmpdir(), 'dawsha-tsserver-'))
  const script = join(directory, 'utility.cjs')
  const cleanup = (): void => {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
    catch (error) { console.warn('Could not remove the TypeScript utility directory:', error) }
  }
  try {
    writeFileSync(script, TSSERVER_UTILITY_SOURCE, { mode: 0o600 })
    const child = utilityProcess.fork(script, [tsserverModulePath(), '--useNodeIpc', '--disableAutomaticTypingAcquisition'], { cwd: folder, stdio: 'ignore', serviceName: 'Dawsha TypeScript' })
    const stop = (): void => {
      try {
        if (!child.pid) child.once('spawn', () => { child.kill() })
        child.kill()
      } finally { cleanup() }
    }
    child.once('exit', cleanup)
    child.once('error', cleanup)
    processes.track(stop, listener => { child.once('exit', listener) })
    return new TsServerClient({
      send: message => child.postMessage(message),
      onMessage: listener => { child.on('message', listener) },
      onStop: listener => { child.once('exit', listener); child.once('error', listener) },
      stop
    })
  } catch (error) {
    cleanup()
    throw error
  }
}
