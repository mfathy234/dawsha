import { appendFileSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatSession } from '../../src/main/chatLog/session'
import { LogTail } from '../../src/main/chatLog/tail'
import type { ChatMessage } from '../../src/shared/chatLog'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dawsha-chat-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const user = (text: string): string => JSON.stringify({ type: 'user', uuid: text, message: { content: text } }) + '\n'
const texts = (session: ChatSession): string[] => {
  const result = session.result()
  return result.status === 'ok' ? result.items.map((item) => (item as ChatMessage).text) : []
}

describe('LogTail', () => {
  it('reads only the new whole lines and holds back a half-written one', async () => {
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, 'one\ntw')
    const tail = new LogTail()
    expect(await tail.read(path)).toEqual({ reset: true, text: 'one\n' })
    appendFileSync(path, 'o\nthree\n')
    expect(await tail.read(path)).toEqual({ reset: false, text: 'two\nthree\n' })
    expect(await tail.read(path)).toEqual({ reset: false, text: '' })
  })

  it('starts over when the file shrinks or is replaced', async () => {
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, 'long first line\nsecond\n')
    const tail = new LogTail()
    await tail.read(path)
    writeFileSync(path, 'x\n')
    expect(await tail.read(path)).toEqual({ reset: true, text: 'x\n' })
    unlinkSync(path)
    writeFileSync(path, 'a much longer replacement line\n')
    expect((await tail.read(path)).reset).toBe(true)
  })

  it('reads only the end of a very large file, from a whole line', async () => {
    const path = join(dir, 'big.jsonl')
    writeFileSync(path, Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n')
    const tail = new LogTail(100)
    const { text } = await tail.read(path)
    expect(text.length).toBeLessThanOrEqual(100)
    expect(text.startsWith('line ')).toBe(true)
    expect(text.endsWith('line 199\n')).toBe(true)
  })

  it('does not split a multi-byte character across reads', async () => {
    const path = join(dir, 'a.jsonl')
    const bytes = Buffer.from('مرحبا\n', 'utf8')
    writeFileSync(path, bytes.subarray(0, 3))
    const tail = new LogTail()
    expect((await tail.read(path)).text).toBe('')
    appendFileSync(path, bytes.subarray(3))
    expect((await tail.read(path)).text).toBe('مرحبا\n')
  })
})

describe('ChatSession', () => {
  it('follows a growing log and reports whether the thread changed', async () => {
    const path = join(dir, 's.jsonl')
    writeFileSync(path, user('first'))
    const session = new ChatSession('claude')
    expect(await session.refresh(path)).toBe(true)
    expect(await session.refresh(path)).toBe(false)
    appendFileSync(path, user('second'))
    expect(await session.refresh(path)).toBe(true)
    expect(texts(session)).toEqual(['first', 'second'])
  })

  it('drops what it read when the log is replaced, as on a resume that rewrites the file', async () => {
    const path = join(dir, 's.jsonl')
    writeFileSync(path, user('old one') + user('old two'))
    const session = new ChatSession('claude')
    await session.refresh(path)
    unlinkSync(path)
    writeFileSync(path, user('new'))
    await session.refresh(path)
    expect(texts(session)).toEqual(['new'])
  })

  it('fails with a reason when a log is full of records it does not know', async () => {
    const path = join(dir, 's.jsonl')
    writeFileSync(path, Array.from({ length: 8 }, () => JSON.stringify({ shape: 'new' })).join('\n') + '\n')
    const session = new ChatSession('codex')
    await session.refresh(path)
    const result = session.result()
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toMatch(/recognise/)
  })
})
