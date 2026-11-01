import type { ChildProcess } from 'node:child_process'

export interface Wire {
  send(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  onStop(listener: () => void): void
  stop(): void
}

export function nodeIpcWire(child: ChildProcess): Wire {
  return {
    send: message => { child.send(message as object) },
    onMessage: listener => { child.on('message', listener) },
    onStop: listener => { child.once('exit', listener); child.once('error', listener) },
    stop: () => { child.kill() }
  }
}

export function stdioWire(child: ChildProcess, kill = (): void => { child.kill() }): Wire {
  let buffer = Buffer.alloc(0)
  let receive: (message: unknown) => void = () => undefined
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > 16 * 1024 * 1024) return kill()
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) break
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))
      const length = match ? Number(match[1]) : NaN
      if (!Number.isSafeInteger(length) || length < 0 || length > 16 * 1024 * 1024) return kill()
      if (buffer.length < end + 4 + length) break
      const body = buffer.subarray(end + 4, end + 4 + length)
      buffer = buffer.subarray(end + 4 + length)
      try { receive(JSON.parse(body.toString('utf8'))) } catch { kill(); break }
    }
  })
  child.stdin?.on('error', () => kill())
  child.stderr?.resume()
  return {
    send: message => {
      const body = Buffer.from(JSON.stringify(message), 'utf8')
      child.stdin?.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
    },
    onMessage: listener => { receive = listener },
    onStop: listener => { child.once('exit', listener); child.once('error', listener) },
    stop: kill
  }
}
