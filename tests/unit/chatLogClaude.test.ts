import { describe, expect, it } from 'vitest'
import { ClaudeChatReader } from '../../src/main/chatLog/claudeReader'
import { CHAT_ITEMS_MAX, type ChatMessage, type ChatTool } from '../../src/shared/chatLog'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
const block = (uuid: string, content: unknown[], extra: object = {}) => ({
  type: 'assistant',
  uuid,
  timestamp: '2026-10-13T14:27:59.000Z',
  message: { id: 'msg_1', role: 'assistant', stop_reason: 'tool_use', content },
  ...extra
})

// Shapes copied from a real Claude Code 2.1 log, with the text replaced.
const session = lines(
  { type: 'queue-operation', operation: 'enqueue' },
  { type: 'user', uuid: 'u1', timestamp: '2026-10-13T14:27:56.000Z', message: { role: 'user', content: 'Add a dark mode toggle' } },
  block('a1', [{ type: 'thinking', thinking: '', signature: 'x' }]),
  block('a2', [{ type: 'text', text: 'I will add a ThemeToggle.' }]),
  block('a3', [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/theme.tsx', old_string: 'a\nb', new_string: 'a\nb\nc' } }]),
  { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'The file has been updated' }] } },
  block('a4', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test -- theme' } }]),
  { type: 'user', uuid: 'u3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: ' Tests  41 passed (41)' }] } },
  { type: 'system', subtype: 'turn_duration' },
  { type: 'attachment', attachment: {} }
)

describe('ClaudeChatReader', () => {
  it('draws prompts, whole text blocks and tools, and skips thinking and bookkeeping records', () => {
    const reader = new ClaudeChatReader()
    reader.feed(session)
    const items = reader.items()
    expect(items.map((item) => item.kind)).toEqual(['message', 'message', 'tool', 'tool'])
    expect((items[0] as ChatMessage).role).toBe('user')
    expect((items[1] as ChatMessage).text).toBe('I will add a ThemeToggle.')
    const edit = items[2] as ChatTool
    expect(edit).toMatchObject({ verb: 'Edited', target: 'src/theme.tsx', added: 3, removed: 2, done: true })
    expect(edit.output).toContain('+c')
    expect(items[3]).toMatchObject({ verb: 'Ran', target: 'npm test -- theme', note: '41 passed', done: true })
  })

  it('keeps a tool open until its result arrives', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines(block('a', [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'sleep 5' } }])))
    expect((reader.items()[0] as ChatTool).done).toBe(false)
    reader.feed(lines({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'done', is_error: true }] } }))
    expect(reader.items()[0]).toMatchObject({ done: true, failed: true, output: 'done', note: 'failed' })
  })

  it('keeps a message the user sends twice in a row', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines({ type: 'user', uuid: 'u1', message: { content: 'continue' } }, block('a1', [{ type: 'text', text: 'ok' }]), { type: 'user', uuid: 'u2', message: { content: 'continue' } }, { type: 'user', uuid: 'u3', message: { content: 'continue' } }))
    expect(reader.items().map((item) => (item as ChatMessage).text)).toEqual(['continue', 'ok', 'continue', 'continue'])
  })

  it('waits for a half-written line and reads it once complete', () => {
    const reader = new ClaudeChatReader()
    const whole = JSON.stringify({ type: 'user', uuid: 'u', message: { content: 'hello' } })
    reader.feed(whole.slice(0, 20))
    expect(reader.items()).toHaveLength(0)
    reader.feed('\n')
    expect(reader.items()).toHaveLength(0)
    reader.feed(`${whole}\n`)
    expect(reader.items()).toHaveLength(1)
  })

  it('ignores sidechain records, meta prompts and command traces', () => {
    const reader = new ClaudeChatReader()
    reader.feed(
      lines(
        { type: 'user', isSidechain: true, message: { content: 'sub agent prompt' } },
        { type: 'user', isMeta: true, message: { content: 'meta' } },
        { type: 'user', message: { content: '<command-name>/model</command-name>' } },
        { type: 'user', message: { content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }, { type: 'text', text: 'real' }] } }
      )
    )
    expect(reader.items().map((item) => (item as ChatMessage).text)).toEqual(['real'])
  })

  it('keeps a prompt that merely starts with a tag', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines({ type: 'user', message: { content: '<div> renders twice, why?' } }))
    expect((reader.items()[0] as ChatMessage).text).toBe('<div> renders twice, why?')
  })

  it('turns the real limit record into a limit notice with its reset time', () => {
    const reader = new ClaudeChatReader()
    reader.feed(
      lines({
        type: 'assistant',
        uuid: 'l1',
        apiError: 'usage_limit_reached',
        apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt: 1791907200, rateLimitType: 'five_hour' } },
        message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 7pm (Africa/Cairo)" }] }
      })
    )
    expect(reader.items()[0]).toMatchObject({ kind: 'notice', notice: 'limit', resetsAt: 1791907200000 })
  })

  it('shows a request interrupted by the user as a notice, not a message', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }))
    expect(reader.items()[0]).toMatchObject({ kind: 'notice', notice: 'interrupted' })
  })

  it('keeps Arabic in logical order and never touches the text', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines(block('x', [{ type: 'text', text: 'أضفت الزرار في الإعدادات' }])))
    expect((reader.items()[0] as ChatMessage).text).toBe('أضفت الزرار في الإعدادات')
  })

  it('bounds a huge message and a huge tool output', () => {
    const reader = new ClaudeChatReader()
    const huge = 'x'.repeat(200_000)
    reader.feed(
      lines(
        block('h', [{ type: 'text', text: huge }]),
        block('b', [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'cat big' } }]),
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'big', content: huge }] } }
      )
    )
    const [message, tool] = reader.items() as [ChatMessage, ChatTool]
    expect(message.text.length).toBeLessThan(25_000)
    expect(tool.output.length).toBeLessThan(7_000)
    expect(tool.outputTruncated).toBe(true)
  })

  it('keeps only the latest items of a very long session and counts what it dropped', () => {
    const reader = new ClaudeChatReader()
    const many = Array.from({ length: CHAT_ITEMS_MAX * 3 }, (_, i) => ({ type: 'user', uuid: `m${i}`, message: { content: `message ${i}` } }))
    reader.feed(lines(...many))
    expect(reader.items()).toHaveLength(CHAT_ITEMS_MAX)
    expect((reader.items().at(-1) as ChatMessage).text).toBe(`message ${CHAT_ITEMS_MAX * 3 - 1}`)
    expect(reader.earlier).toBeGreaterThan(0)
  })

  it('counts records so a log in an unknown format can be recognised', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines(...Array.from({ length: 6 }, () => ({ kind: 'weird', body: 1 }))))
    expect(reader.stats).toEqual({ lines: 6, known: 0 })
  })
})
