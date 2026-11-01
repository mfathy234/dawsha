import { describe, expect, it } from 'vitest'
import { toolKind } from '../../src/shared/chatKind'
import { ClaudeChatReader } from '../../src/main/chatLog/claudeReader'
import { CodexChatReader } from '../../src/main/chatLog/codexReader'
import type { ChatTool } from '../../src/shared/chatLog'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
const use = (id: string, name: string, input: object) => ({ type: 'assistant', uuid: id, message: { content: [{ type: 'tool_use', id, name, input }] } })
const done = (item: object) => ({ type: 'event_msg', payload: { type: 'item_completed', item } })

describe('toolKind', () => {
  it('maps the names Claude logs', () => {
    expect(toolKind('Bash')).toBe('shell')
    expect(toolKind('PowerShell')).toBe('shell')
    expect(toolKind('Edit')).toBe('edit')
    expect(toolKind('MultiEdit')).toBe('edit')
    expect(toolKind('Write')).toBe('create')
    expect(toolKind('Read')).toBe('read')
    expect(toolKind('Grep')).toBe('search')
    expect(toolKind('Glob')).toBe('search')
    expect(toolKind('Task')).toBe('agent')
    expect(toolKind('Agent')).toBe('agent')
    expect(toolKind('WebFetch')).toBe('web')
    expect(toolKind('WebSearch')).toBe('web')
  })

  it('maps the item types Codex logs to the same kinds', () => {
    expect(toolKind('CommandExecution')).toBe('shell')
    expect(toolKind('FileChange')).toBe('edit')
    expect(toolKind('McpToolCall')).toBe('other')
  })

  it('falls back to other for anything unknown or not a name', () => {
    expect(toolKind('mcp__github__list_issues')).toBe('other')
    expect(toolKind('')).toBe('other')
    expect(toolKind(undefined)).toBe('other')
    expect(toolKind(42)).toBe('other')
  })
})

describe('the kind each reader gives a tool row', () => {
  it('reads Claude calls', () => {
    const reader = new ClaudeChatReader()
    reader.feed(
      lines(
        use('1', 'Bash', { command: 'ls' }),
        use('2', 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }),
        use('3', 'Write', { file_path: 'b.ts', content: 'x' }),
        use('4', 'Read', { file_path: 'c.ts' }),
        use('5', 'Grep', { pattern: 'x' }),
        use('6', 'Task', { description: 'look around' }),
        use('7', 'WebFetch', { url: 'https://example.com' })
      )
    )
    expect(reader.items().map((item) => (item as ChatTool).activity)).toEqual(['shell', 'edit', 'create', 'read', 'search', 'agent', 'web'])
  })

  it('reads Codex items', () => {
    const reader = new CodexChatReader()
    reader.feed(
      lines(
        done({ type: 'CommandExecution', id: 'c', command: ['bash', '-lc', 'ls'], status: 'completed', aggregated_output: '', exit_code: 0 }),
        done({ type: 'FileChange', id: 'f', status: 'completed', changes: { 'a.ts': { type: 'update', unified_diff: '@@\n-a\n+b\n' }, 'b.ts': { type: 'add', content: 'x\n' } } }),
        done({ type: 'McpToolCall', id: 'm', server: 's', tool: 't', status: 'completed', result: { content: [] } })
      )
    )
    expect(reader.items().map((item) => (item as ChatTool).activity)).toEqual(['shell', 'edit', 'create', 'other'])
  })
})
