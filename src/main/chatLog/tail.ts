import { open, stat } from 'node:fs/promises'

export const CHAT_MAX_BYTES = 8 * 1024 * 1024

export interface TailRead {
  /** The file is a different one or started over, so everything read before is stale. */
  reset: boolean
  /** Whole lines added since the last read; a line still being written waits for the next read. */
  text: string
}

async function readBytes(path: string, from: number, to: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(to - from)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Follows one growing log file by polling: reads only new bytes, holds back half-written lines, starts over when the file is replaced or shortened. */
export class LogTail {
  private offset = 0
  private identity = ''
  private started = false
  private readonly maxBytes: number

  constructor(maxBytes = CHAT_MAX_BYTES) {
    this.maxBytes = maxBytes
  }

  async read(path: string): Promise<TailRead> {
    const info = await stat(path)
    const identity = `${info.ino}:${Math.round(info.birthtimeMs)}`
    const reset = !this.started || identity !== this.identity || info.size < this.offset
    if (reset) this.offset = await this.firstOffset(path, info.size)
    this.started = true
    this.identity = identity
    if (info.size <= this.offset) return { reset, text: '' }
    const bytes = await readBytes(path, this.offset, info.size)
    const end = bytes.lastIndexOf(0x0a)
    if (end < 0) return { reset, text: '' }
    this.offset += end + 1
    return { reset, text: bytes.subarray(0, end + 1).toString('utf8') }
  }

  private async firstOffset(path: string, size: number): Promise<number> {
    if (size <= this.maxBytes) return 0
    const from = size - this.maxBytes
    const probe = await readBytes(path, from, Math.min(size, from + 65536))
    const newline = probe.indexOf(0x0a)
    return newline < 0 ? size : from + newline + 1
  }
}
