import { describe, expect, it } from 'vitest'
import { CodexChatReader } from '../../src/main/chatLog/codexReader'
import type { ChatMessage, ChatTool } from '../../src/shared/chatLog'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
const done = (item: object, timestamp = '2026-10-26T21:21:04.857Z') => ({ timestamp, type: 'event_msg', payload: { type: 'item_completed', thread_id: 't', item } })

// Shapes copied from a real Codex 0.164 rollout, with the text replaced.
const rollout = lines(
  { type: 'session_meta', payload: { id: 's1', cwd: 'C:\\work\\app' } },
  { type: 'event_msg', payload: { type: 'task_started', turn_id: 'a' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for C:\\work' }] } },
  done({ type: 'UserMessage', id: 'um1', content: [{ type: 'text', text: 'Fix the flaky login test', text_elements: [] }] }),
  done({ type: 'AgentMessage', id: 'am1', content: [{ type: 'Text', text: 'I will read the test first.' }], phase: 'commentary' }),
  { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will read the test first.' }] } },
  done({
    type: 'CommandExecution',
    id: 'cx1',
    command: ['C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-Command', 'npm test -- login'],
    status: 'completed',
    aggregated_output: ' Tests  12 passed (12)\r\n',
    exit_code: 0
  }),
  done({
    type: 'FileChange',
    id: 'fc1',
    status: 'completed',
    changes: {
      'src\\login.ts': { type: 'update', unified_diff: '@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+newer\n', move_path: null },
      'src\\fresh.ts': { type: 'add', content: 'a\nb\n' }
    }
  }),
  done({ type: 'Reasoning', id: 'r1' }),
  done({ type: 'AgentMessage', id: 'am2', content: [{ type: 'Text', text: 'Fixed.' }], phase: 'final_answer' }),
  { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'a' } }
)

describe('CodexChatReader', () => {
  it('draws messages and tools from item_completed records, not the injected context messages', () => {
    const reader = new CodexChatReader()
    reader.feed(rollout)
    const items = reader.items()
    expect(items.map((item) => item.kind)).toEqual(['message', 'message', 'tool', 'tool', 'tool', 'message'])
    expect((items[0] as ChatMessage).text).toBe('Fix the flaky login test')
    expect((items[1] as ChatMessage).role).toBe('agent')
    expect(items[2]).toMatchObject({ verb: 'Ran', target: 'npm test -- login', note: '12 passed', done: true })
    expect(items[3]).toMatchObject({ verb: 'Edited', target: 'src\\login.ts', added: 2, removed: 1 })
    expect(items[4]).toMatchObject({ verb: 'Created', target: 'src\\fresh.ts', added: 2 })
  })

  it('marks a failed command', () => {
    const reader = new CodexChatReader()
    reader.feed(lines(done({ type: 'CommandExecution', id: 'x', command: ['bash', '-lc', 'false'], status: 'failed', aggregated_output: 'nope', exit_code: 1 })))
    expect(reader.items()[0]).toMatchObject({ failed: true, output: 'nope' })
  })

  it('reads the older user_message and agent_message events and does not repeat a message sent both ways', () => {
    const reader = new CodexChatReader()
    reader.feed(
      lines(
        { type: 'event_msg', payload: { type: 'user_message', message: 'hello' } },
        done({ type: 'UserMessage', id: 'dup', content: [{ type: 'text', text: 'hello' }] }),
        { type: 'event_msg', payload: { type: 'agent_message', message: 'hi there' } }
      )
    )
    expect(reader.items().map((item) => (item as ChatMessage).text)).toEqual(['hello', 'hi there'])
  })

  it('keeps a message sent twice in a row, even when each arrives both ways', () => {
    const reader = new CodexChatReader()
    const both = (id: string) => [{ type: 'event_msg', payload: { type: 'user_message', message: 'continue' } }, done({ type: 'UserMessage', id, content: [{ type: 'text', text: 'continue' }] })]
    reader.feed(lines(...both('a'), ...both('b')))
    expect(reader.items().map((item) => (item as ChatMessage).text)).toEqual(['continue', 'continue'])
    const single = new CodexChatReader()
    single.feed(lines(done({ type: 'UserMessage', id: 'a', content: [{ type: 'text', text: 'continue' }] }), done({ type: 'UserMessage', id: 'b', content: [{ type: 'text', text: 'continue' }] })))
    expect(single.items()).toHaveLength(2)
  })

  it('shows a usage limit once per time a window fills', () => {
    const reader = new CodexChatReader()
    const count = (used: number) => ({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: 1793067662 } } } })
    reader.feed(lines(count(40), count(100), count(100), count(0), count(100)))
    const notices = reader.items().filter((item) => item.kind === 'notice')
    expect(notices).toHaveLength(2)
    expect(notices[0]).toMatchObject({ notice: 'limit', resetsAt: 1793067662000 })
  })

  it('treats an interrupted turn as a notice', () => {
    const reader = new CodexChatReader()
    reader.feed(lines({ type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted' } }))
    expect(reader.items()[0]).toMatchObject({ kind: 'notice', notice: 'interrupted' })
  })

  it('waits for a half-written final line', () => {
    const reader = new CodexChatReader()
    const whole = JSON.stringify(done({ type: 'AgentMessage', id: 'p', content: [{ type: 'Text', text: 'partial' }] }))
    reader.feed(`${whole.slice(0, 40)}\n`)
    expect(reader.items()).toHaveLength(0)
    reader.feed(`${whole}\n`)
    expect((reader.items()[0] as ChatMessage).text).toBe('partial')
  })

  it('counts no known records in a log that is not a Codex rollout', () => {
    const reader = new CodexChatReader()
    reader.feed(lines(...Array.from({ length: 6 }, () => ({ type: 'assistant', message: {} }))))
    expect(reader.stats.known).toBe(0)
  })

  it('bounds a huge command output', () => {
    const reader = new CodexChatReader()
    reader.feed(lines(done({ type: 'CommandExecution', id: 'b', command: ['x'], status: 'completed', aggregated_output: 'y\n'.repeat(100_000), exit_code: 0 })))
    const tool = reader.items()[0] as ChatTool
    expect(tool.outputTruncated).toBe(true)
    expect(tool.output.split('\n').length).toBeLessThanOrEqual(82)
  })
})
