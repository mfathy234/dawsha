import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GEMINI_BUSY_MS,
  isGeminiChatFile,
  matchGeminiSessions,
  parseGeminiChat,
  parseLegacyGeminiChat,
  ptyStatus,
  toGeminiSession
} from '../../src/shared/geminiSession'

const fixture = readFileSync(join(__dirname, 'fixtures', 'gemini-chat.jsonl'), 'utf8')

describe('parseGeminiChat', () => {
  it('reads id, times, name from the first real prompt and the model, skipping junk lines', () => {
    const chat = parseGeminiChat(fixture)
    expect(chat).toEqual({
      sessionId: '11111111-2222-4333-8444-555555555555',
      startedAt: Date.parse('2026-10-08T12:00:00.000Z'),
      updatedAt: Date.parse('2026-10-08T12:00:20.500Z'),
      name: 'Explain the build script',
      model: 'gemini-2.5-pro',
      hasConversation: true,
      recentTools: []
    })
  })

  it('prefers a recorded summary over the first prompt', () => {
    const text = `${fixture}{"$set":{"summary":"Fixing the build"}}\n`
    expect(parseGeminiChat(text)?.name).toBe('Fixing the build')
  })

  it('keeps recent tool names and times from Gemini messages', () => {
    const text = `${fixture}${JSON.stringify({ id: 'm4', type: 'gemini', timestamp: '2026-10-08T12:00:21.000Z', toolCalls: [{ name: 'read_file' }, { name: 'run_shell_command' }] })}\n`
    expect(parseGeminiChat(text)?.recentTools).toEqual([
      { name: 'read_file', at: Date.parse('2026-10-08T12:00:21.000Z') },
      { name: 'run_shell_command', at: Date.parse('2026-10-08T12:00:21.000Z') }
    ])
  })

  it('has no conversation and no name for a metadata-only file', () => {
    const chat = parseGeminiChat(fixture.split('\n')[0])
    expect(chat?.hasConversation).toBe(false)
    expect(chat?.name).toBeUndefined()
  })

  it('returns null without a session id and tolerates empty or garbled input', () => {
    expect(parseGeminiChat('')).toBeNull()
    expect(parseGeminiChat('garbage\n{"id":"m1","type":"user","content":"hi"}')).toBeNull()
  })

  it('truncates long names to 100 characters', () => {
    const long = JSON.stringify({ id: 'm', type: 'user', content: 'x'.repeat(300) })
    const head = '{"sessionId":"s","projectHash":"h","startTime":"2026-10-08T12:00:00.000Z"}'
    expect(parseGeminiChat(`${head}\n${long}`)?.name).toHaveLength(100)
  })
})

describe('parseLegacyGeminiChat', () => {
  it('reads the older single-document format', () => {
    const doc = JSON.stringify(
      {
        sessionId: 's-1',
        projectHash: 'h',
        startTime: '2026-10-08T12:00:00.000Z',
        lastUpdated: '2026-10-08T12:05:00.000Z',
        summary: 'Old chat',
        messages: [
          { id: 'a', type: 'user', content: 'hello' },
          { id: 'b', type: 'gemini', content: 'hi', model: 'gemini-2.5-flash' }
        ]
      },
      null,
      2
    )
    const chat = parseLegacyGeminiChat(doc)
    expect(chat).toMatchObject({ sessionId: 's-1', name: 'Old chat', model: 'gemini-2.5-flash', hasConversation: true })
    expect(parseLegacyGeminiChat('not json')).toBeNull()
  })
})

describe('gemini helpers', () => {
  it('recognises chat file names', () => {
    expect(isGeminiChatFile('session-2026-10-08T12-00-11111111.jsonl')).toBe(true)
    expect(isGeminiChatFile('session-2026-10-08T12-00-11111111.json')).toBe(true)
    expect(isGeminiChatFile('logs.json')).toBe(false)
  })

  it('merges file time into the session and matches tabs by their exact id', () => {
    const chat = parseGeminiChat(fixture)
    if (!chat) throw new Error('fixture did not parse')
    const session = toGeminiSession(chat, Date.parse('2026-10-08T13:00:00.000Z'))
    expect(session.updatedAt).toBe(Date.parse('2026-10-08T13:00:00.000Z'))
    const matched = matchGeminiSessions(
      [{ id: 'a', sessionId: session.sessionId }, { id: 'b', sessionId: 'other' }, { id: 'c' }],
      [session]
    )
    expect([...matched.keys()]).toEqual(['a'])
  })

  it('reports busy for output within 2.5 seconds, idle otherwise', () => {
    expect(ptyStatus(undefined, 10_000)).toBe('idle')
    expect(ptyStatus(10_000 - (GEMINI_BUSY_MS - 1), 10_000)).toBe('busy')
    expect(ptyStatus(10_000 - GEMINI_BUSY_MS, 10_000)).toBe('idle')
  })
})
