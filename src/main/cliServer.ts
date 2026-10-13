import { existsSync, unlinkSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import type { CliReply, CliRequest } from '../shared/cli'

const MAX_REQUEST_BYTES = 64 * 1024

export function pipePath(): string {
  if (process.env.DAWSHA_PIPE) return process.env.DAWSHA_PIPE
  const user = (process.env.USERNAME || process.env.USER || userInfo().username || 'user').replace(/[^A-Za-z0-9_.-]/g, '_')
  if (process.platform === 'win32') return `\\\\.\\pipe\\dawsha-${user}`
  // A Unix socket outside Windows. Keep it short: macOS caps socket paths near 104 bytes.
  return join(process.env.XDG_RUNTIME_DIR || tmpdir(), `dawsha-${user}.sock`)
}

export function isCliRequest(value: unknown): value is CliRequest {
  if (typeof value !== 'object' || value === null) return false
  const request = value as Record<string, unknown>
  return Array.isArray(request.args) && request.args.every((a) => typeof a === 'string') && typeof request.cwd === 'string'
}

export function startCliServer(run: (request: CliRequest) => Promise<CliReply>, path: string = pipePath()): Server {
  const server = createServer((socket) => {
    let buffer = ''
    let handled = false
    const reply = (value: CliReply): void => {
      socket.end(`${JSON.stringify(value)}\n`)
    }
    socket.setEncoding('utf8')
    socket.on('error', () => undefined)
    socket.on('data', (chunk: string) => {
      if (handled) return
      buffer += chunk
      if (buffer.length > MAX_REQUEST_BYTES) {
        handled = true
        reply({ ok: false, exit: 2, out: 'dawsha: request too large.' })
        return
      }
      const end = buffer.indexOf('\n')
      if (end < 0) return
      handled = true
      let request: unknown
      try {
        request = JSON.parse(buffer.slice(0, end))
      } catch {
        reply({ ok: false, exit: 2, out: 'dawsha: could not read the request.' })
        return
      }
      if (!isCliRequest(request)) {
        reply({ ok: false, exit: 2, out: 'dawsha: could not read the request.' })
        return
      }
      run(request).then(reply, (error: unknown) => reply({ ok: false, exit: 1, out: `dawsha: ${(error as Error).message}` }))
    })
  })
  server.on('error', () => undefined)
  // Only one Dawsha runs at a time (single-instance lock), so a socket file left here is from a crash.
  if (process.platform !== 'win32' && existsSync(path)) {
    try { unlinkSync(path) } catch { /* listen reports the failure */ }
  }
  server.listen(path)
  return server
}
