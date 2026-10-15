import { describe, expect, it } from 'vitest'
import { classifyTool, createLineParser, lineCount, parseClaudeTimeline, parseCodexTimeline, parseGeminiTimeline, parsePatch } from '../../src/shared/timelineParse'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
const T = (second: number): string => new Date(Date.UTC(2026, 9, 8, 9, 0, second)).toISOString()
const at = (second: number): number => Date.parse(T(second))

describe('classifyTool', () => {
  it('classifies reads, edits and commands across agents', () => {
    expect(classifyTool('Read', { file_path: 'a.ts' })).toEqual({ kind: 'read', paths: ['a.ts'] })
    expect(classifyTool('read_many_files', { paths: ['a', 'b'] })).toEqual({ kind: 'read', paths: ['a', 'b'] })
    expect(classifyTool('Edit', { file_path: 'a.ts', old_string: 'x\ny', new_string: 'z' })).toEqual({
      kind: 'edit',
      edits: [{ path: 'a.ts', added: 1, removed: 2 }]
    })
    expect(classifyTool('Write', { file_path: 'b.ts', content: 'one\ntwo\nthree\n' })).toEqual({ kind: 'edit', edits: [{ path: 'b.ts', added: 3, removed: 0 }] })
    expect(classifyTool('shell', { command: ['bash', '-lc', 'npm test'] })).toEqual({ kind: 'command', command: 'npm test' })
    expect(classifyTool('WebFetch', { url: 'x' })).toBeNull()
  })

  it('sums MultiEdit parts into one edit', () => {
    const tool = classifyTool('MultiEdit', { file_path: 'a.ts', edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'd\ne', new_string: 'f' }] })
    expect(tool).toEqual({ kind: 'edit', edits: [{ path: 'a.ts', added: 3, removed: 3 }] })
  })
})

describe('parsePatch and lineCount', () => {
  it('counts added and removed lines per file', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n+more\n*** Add File: src/b.ts\n+x\n*** End Patch'
    expect(parsePatch(patch)).toEqual([
      { path: 'src/a.ts', added: 2, removed: 1 },
      { path: 'src/b.ts', added: 1, removed: 0 }
    ])
  })

  it('ignores a trailing newline when counting lines', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('a\n')).toBe(1)
    expect(lineCount('a\nb')).toBe(2)
  })
})

describe('parseClaudeTimeline', () => {
  const text = lines(
    { type: 'user', timestamp: T(0), message: { content: 'Add retry to the sender' } },
    { type: 'user', isMeta: true, timestamp: T(1), message: { content: 'meta' } },
    {
      type: 'assistant',
      timestamp: T(10),
      message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'src/sender.ts' } }] }
    },
    {
      type: 'assistant',
      timestamp: T(20),
      message: { content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'src/sender.ts', old_string: 'a', new_string: 'b\nc' } }] }
    },
    {
      type: 'user',
      timestamp: T(21),
      toolUseResult: { structuredPatch: [{ lines: [' keep', '-a', '+b', '+c', '+d'] }] },
      message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }] }
    },
    { type: 'assistant', timestamp: T(30), message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } },
    {
      type: 'user',
      timestamp: T(40),
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'Tests  1 failed | 23 passed (24)' }] }] }
    },
    { type: 'assistant', timestamp: T(50), message: { content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'ls missing' } }] } },
    { type: 'user', timestamp: T(51), message: { content: [{ type: 'tool_result', tool_use_id: 'c1', is_error: true, content: 'ls: cannot access missing' }] } }
  )

  it('extracts prompts, replies, reads, edits, tests, commands and errors with timestamps', () => {
    const events = parseClaudeTimeline(text)
    expect(events.map((e) => e.kind)).toEqual(['prompt', 'reply', 'read', 'edit', 'test', 'command', 'error'])
    expect(events[0]).toMatchObject({ at: at(0), text: 'Add retry to the sender' })
    expect(events[2]).toMatchObject({ paths: ['src/sender.ts'] })
    expect(events[3]).toMatchObject({ path: 'src/sender.ts', added: 3, removed: 1 })
    expect(events[4]).toMatchObject({ command: 'npm test', passed: 23, failed: 1, ok: false, text: '23 passed · 1 failed' })
    expect(events[6]).toMatchObject({ at: at(51), text: 'ls: cannot access missing' })
  })

  it('skips sidechains and unparsable lines', () => {
    const noisy = `not json\n${lines({ type: 'user', isSidechain: true, timestamp: T(0), message: { content: 'hidden' } })}`
    expect(parseClaudeTimeline(noisy)).toEqual([])
  })
})

describe('parseCodexTimeline', () => {
  const shell = (callId: string): unknown => ({
    type: 'response_item',
    timestamp: T(5),
    payload: { type: 'function_call', name: 'shell', call_id: callId, arguments: JSON.stringify({ command: ['bash', '-lc', 'pytest -q'] }) }
  })
  const text = lines(
    { type: 'event_msg', timestamp: T(0), payload: { type: 'user_message', message: 'Fix the flaky test' } },
    shell('c1'),
    { type: 'response_item', timestamp: T(8), payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: '=== 1 failed, 4 passed in 1s ===', metadata: { exit_code: 1 } }) } },
    {
      type: 'response_item',
      timestamp: T(12),
      payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input: '*** Begin Patch\n*** Update File: tests/a.py\n-x\n+y\n*** End Patch' }
    },
    { type: 'response_item', timestamp: T(13), payload: { type: 'custom_tool_call_output', call_id: 'p1', output: 'done' } },
    { ...(shell('c2') as object), timestamp: T(15) },
    { type: 'response_item', timestamp: T(18), payload: { type: 'function_call_output', call_id: 'c2', output: 'Exit code: 0\nWall time: 1 seconds\nOutput:\n5 passed in 1s' } },
    { type: 'event_msg', timestamp: T(20), payload: { type: 'agent_message', message: 'Fixed.' } },
    { type: 'event_msg', timestamp: T(25), payload: { type: 'error', message: 'stream disconnected' } }
  )

  it('extracts prompts, test runs, patches, replies and errors', () => {
    const events = parseCodexTimeline(text)
    expect(events.map((e) => e.kind)).toEqual(['prompt', 'test', 'edit', 'test', 'reply', 'error'])
    expect(events[1]).toMatchObject({ passed: 4, failed: 1, ok: false })
    expect(events[2]).toMatchObject({ path: 'tests/a.py', added: 1, removed: 1 })
    expect(events[3]).toMatchObject({ passed: 5, ok: true, text: '5 passed' })
    expect(events[5]).toMatchObject({ text: 'stream disconnected' })
  })
})

describe('parseGeminiTimeline', () => {
  const chat = JSON.stringify({
    sessionId: 's1',
    startTime: T(0),
    messages: [
      { id: 'm1', type: 'user', timestamp: T(0), content: 'Rename the helper' },
      {
        id: 'm2',
        type: 'gemini',
        timestamp: T(10),
        content: 'Renaming now.',
        toolCalls: [
          { name: 'replace', args: { file_path: 'src/h.ts', old_string: 'a', new_string: 'b' }, status: 'success', timestamp: T(11) },
          {
            name: 'run_shell_command',
            args: { command: 'go test ./...' },
            status: 'success',
            timestamp: T(12),
            result: [{ functionResponse: { response: { output: 'ok  \tpkg/a\t0.2s\nFAIL\tpkg/b\t0.1s' } } }]
          },
          { name: 'read_file', args: { absolute_path: 'src/x.ts' }, status: 'error', timestamp: T(13), result: [{ functionResponse: { response: { error: 'not found' } } }] }
        ]
      }
    ]
  })

  it('extracts prompts, replies, edits, tests and tool errors', () => {
    const events = parseGeminiTimeline(chat)
    expect(events.map((e) => e.kind)).toEqual(['prompt', 'reply', 'edit', 'test', 'read', 'error'])
    expect(events[2]).toMatchObject({ at: at(11), path: 'src/h.ts', added: 1, removed: 1 })
    expect(events[3]).toMatchObject({ passed: 1, failed: 1, ok: false })
    expect(events[5]).toMatchObject({ text: 'not found' })
  })
})

describe('createLineParser', () => {
  const records = [
    { type: 'user', timestamp: T(0), message: { content: 'Run the tests' } },
    { type: 'assistant', timestamp: T(5), message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', timestamp: T(9), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Tests  24 passed (24)' }] } },
    { type: 'user', timestamp: T(20), message: { content: 'Thanks' } }
  ]

  it('gives the same events when the log is fed in pieces, even when a result lands in a later piece', () => {
    const whole = parseClaudeTimeline(lines(...records))
    const parser = createLineParser('claude')
    parser.feed(lines(records[0], records[1]))
    expect(parser.events().find((e) => e.kind === 'test')?.ok).toBeUndefined()
    parser.feed(lines(records[2]))
    parser.feed(lines(records[3]))
    expect(parser.events()).toEqual(whole)
    expect(parser.events().find((e) => e.kind === 'test')).toMatchObject({ passed: 24, ok: true })
  })

  it('keeps the Codex conversation source chosen from the first piece', () => {
    const parser = createLineParser('codex')
    parser.feed(lines({ type: 'event_msg', timestamp: T(0), payload: { type: 'user_message', message: 'Hi' } }))
    parser.feed(lines({ type: 'response_item', timestamp: T(1), payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'dup' }] } }))
    expect(parser.events().map((e) => e.kind)).toEqual(['prompt'])
  })
})
