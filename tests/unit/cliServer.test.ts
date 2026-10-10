import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { isCliRequest, pipePath, startCliServer } from '../../src/main/cliServer'
import type { CliReply, CliRequest } from '../../src/shared/cli'

const servers: { close(): void }[] = []
let counter = 0
const uniquePipe = (): string => `\\\\.\\pipe\\dawsha-unit-${process.pid}-${(counter += 1)}`

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

function talk(path: string, payload: string): Promise<CliReply> {
  return new Promise((resolve, reject) => {
    const socket = connect(path)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(payload))
    socket.on('data', (chunk: string) => {
      buffer += chunk
    })
    socket.on('end', () => resolve(JSON.parse(buffer) as CliReply))
    socket.on('error', reject)
  })
}

async function serve(run: (request: CliRequest) => Promise<CliReply>): Promise<string> {
  const path = uniquePipe()
  const server = startCliServer(run, path)
  servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  return path
}

describe('cli pipe server', () => {
  it('runs a request and writes the reply', async () => {
    const seen: CliRequest[] = []
    const path = await serve(async (request) => {
      seen.push(request)
      return { ok: true, exit: 0, out: `ran ${request.args.join(' ')}` }
    })
    const reply = await talk(path, `${JSON.stringify({ args: ['ls'], cwd: 'C:\\work' })}\n`)
    expect(reply).toEqual({ ok: true, exit: 0, out: 'ran ls' })
    expect(seen).toEqual([{ args: ['ls'], cwd: 'C:\\work' }])
  })

  it('rejects malformed requests with a non-zero exit', async () => {
    const path = await serve(async () => ({ ok: true, exit: 0, out: '' }))
    expect((await talk(path, 'not json\n')).exit).toBe(2)
    expect((await talk(path, `${JSON.stringify({ args: [1], cwd: 'x' })}\n`)).exit).toBe(2)
  })

  it('turns a throwing handler into an error reply', async () => {
    const path = await serve(async () => {
      throw new Error('boom')
    })
    expect(await talk(path, `${JSON.stringify({ args: [], cwd: 'x' })}\n`)).toEqual({ ok: false, exit: 1, out: 'dawsha: boom' })
  })
})

describe('pipePath and isCliRequest', () => {
  it('honours the override and names the pipe per user', () => {
    const before = process.env.DAWSHA_PIPE
    process.env.DAWSHA_PIPE = '\\\\.\\pipe\\custom'
    expect(pipePath()).toBe('\\\\.\\pipe\\custom')
    delete process.env.DAWSHA_PIPE
    expect(pipePath()).toMatch(/^\\\\\.\\pipe\\dawsha-.+/)
    if (before !== undefined) process.env.DAWSHA_PIPE = before
  })

  it('validates request shape', () => {
    expect(isCliRequest({ args: ['a'], cwd: 'x' })).toBe(true)
    expect(isCliRequest({ args: 'a', cwd: 'x' })).toBe(false)
    expect(isCliRequest(null)).toBe(false)
  })
})
