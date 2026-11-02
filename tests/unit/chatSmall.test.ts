import { describe, expect, it } from 'vitest'
import { ClaudeChatReader } from '../../src/main/chatLog/claudeReader'
import { CodexChatReader } from '../../src/main/chatLog/codexReader'
import { CHAT_MESSAGE_MAX, type ChatMessage, type ChatNotice, type ChatTool } from '../../src/shared/chatLog'
import { dayKey, dayLabel, dayStarts } from '../../src/shared/chatTime'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
const user = (content: unknown, extra: object = {}) => ({ type: 'user', uuid: `u${Math.random()}`, message: { role: 'user', content }, ...extra })
const done = (item: object) => ({ timestamp: '2026-10-26T21:21:04.857Z', type: 'event_msg', payload: { type: 'item_completed', item } })

describe('compaction', () => {
  it('becomes one notice with the summary kept as detail, not a message', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }, user('This session is being continued from a previous conversation...', { isCompactSummary: true })))
    const items = reader.items()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'notice', notice: 'compact', text: 'Conversation compacted' })
    expect((items[0] as ChatNotice).detail).toContain('continued from a previous')
  })

  it('makes a notice from a summary that has no boundary before it', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines(user([{ type: 'text', text: 'Summary text' }], { isCompactSummary: true })))
    expect(reader.items()[0]).toMatchObject({ kind: 'notice', notice: 'compact', detail: 'Summary text' })
  })
})

describe('slash commands', () => {
  it('draw a quiet row with the printed output folded inside', () => {
    const reader = new ClaudeChatReader()
    reader.feed(
      lines(
        user('<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'),
        user('<local-command-stdout>Set model to opus</local-command-stdout>')
      )
    )
    const [row] = reader.items() as ChatTool[]
    expect(reader.items()).toHaveLength(1)
    expect(row).toMatchObject({ kind: 'tool', verb: 'Ran', target: '/model opus', done: true, output: 'Set model to opus' })
  })

  it('ignore output that does not follow a command', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines(user('<local-command-stdout>stray</local-command-stdout>')))
    expect(reader.items()).toHaveLength(0)
  })
})

describe('reasoning', () => {
  it('Claude thinking becomes a Thought row only when it has text', () => {
    const reader = new ClaudeChatReader()
    reader.feed(
      lines(
        { type: 'assistant', uuid: 'a', message: { content: [{ type: 'thinking', thinking: '', signature: 's' }] } },
        { type: 'assistant', uuid: 'b', message: { content: [{ type: 'thinking', thinking: 'Weigh two options.' }] } }
      )
    )
    const items = reader.items() as ChatTool[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ verb: 'Thought', output: 'Weigh two options.', done: true })
  })

  it('Codex Reasoning uses its summary, and nothing when empty', () => {
    const reader = new CodexChatReader()
    reader.feed(lines(done({ type: 'Reasoning', id: 'r1', summary: [{ type: 'summary_text', text: 'Plan the fix' }] }), done({ type: 'Reasoning', id: 'r2', summary: [], content: [] })))
    const items = reader.items() as ChatTool[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ verb: 'Thought', output: 'Plan the fix' })
  })
})

describe('truncated messages', () => {
  it('are flagged when they hit the length cap and not otherwise', () => {
    const reader = new ClaudeChatReader()
    reader.feed(
      lines(
        { type: 'assistant', uuid: 'a', message: { content: [{ type: 'text', text: 'x'.repeat(CHAT_MESSAGE_MAX + 500) }] } },
        { type: 'assistant', uuid: 'b', message: { content: [{ type: 'text', text: 'short' }] } }
      )
    )
    const [long, short] = reader.items() as ChatMessage[]
    expect(long.truncated).toBe(true)
    expect(short.truncated).toBeUndefined()
  })
})

describe('days', () => {
  const noon = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12).getTime()

  it('finds where each day starts, skipping undated items', () => {
    const times = [undefined, noon(2026, 10, 1), noon(2026, 10, 1) + 1000, undefined, noon(2026, 10, 2)]
    expect(dayStarts(times)).toEqual([1, 4])
    expect(dayStarts([])).toEqual([])
  })

  it('labels today, yesterday and older days', () => {
    const now = noon(2026, 10, 20)
    expect(dayLabel(now, now)).toBe('Today')
    expect(dayLabel(noon(2026, 10, 19), now)).toBe('Yesterday')
    expect(dayLabel(noon(2026, 10, 3), now, 'en-US')).toMatch(/Oct/)
    expect(dayKey(noon(2026, 10, 3))).toBe('2026-10-3')
  })
})
