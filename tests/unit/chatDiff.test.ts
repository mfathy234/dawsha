import { describe, expect, it } from 'vitest'
import { ClaudeChatReader } from '../../src/main/chatLog/claudeReader'
import { CodexChatReader } from '../../src/main/chatLog/codexReader'
import { DIFF_LINES_MAX, diffCounts, diffFromStructuredPatch, diffFromText, firstChangedLine } from '../../src/shared/chatDiff'
import type { ChatTool } from '../../src/shared/chatLog'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('diffFromStructuredPatch', () => {
  const patch = [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, lines: [' keep', '-old', '+new', '+extra', ' tail'] }, { oldStart: 40, newStart: 41, lines: ['+later'] }]

  it('numbers kept and added lines from the new file and removed ones from the old', () => {
    const diff = diffFromStructuredPatch(patch)
    expect(diff?.lines.slice(0, 5)).toEqual([
      { k: 'ctx', n: 10, t: 'keep' },
      { k: 'del', n: 11, t: 'old' },
      { k: 'add', n: 11, t: 'new' },
      { k: 'add', n: 12, t: 'extra' },
      { k: 'ctx', n: 13, t: 'tail' }
    ])
    expect(diff?.lines[5]).toEqual({ k: 'gap', t: '' })
    expect(diff?.lines[6]).toEqual({ k: 'add', n: 41, t: 'later' })
  })

  it('gives the first changed line and counts', () => {
    expect(firstChangedLine(patch)).toBe(10)
    expect(diffCounts(diffFromStructuredPatch(patch)!)).toEqual({ added: 3, removed: 1 })
  })

  it('is null for no hunks or junk', () => {
    expect(diffFromStructuredPatch([])).toBeNull()
    expect(diffFromStructuredPatch('x')).toBeNull()
    expect(diffFromStructuredPatch([null, 4])).toBeNull()
    expect(firstChangedLine([])).toBeUndefined()
  })

  it('bounds a huge patch', () => {
    const big = [{ oldStart: 1, newStart: 1, lines: Array.from({ length: DIFF_LINES_MAX + 50 }, (_, i) => `+l${i}`) }]
    const diff = diffFromStructuredPatch(big)
    expect(diff?.lines).toHaveLength(DIFF_LINES_MAX)
    expect(diff?.more).toBe(50)
  })
})

describe('diffFromText', () => {
  it('reads bare marked lines without numbers', () => {
    expect(diffFromText('-a\n+b\n+c')?.lines).toEqual([{ k: 'del', t: 'a' }, { k: 'add', t: 'b' }, { k: 'add', t: 'c' }])
  })

  it('numbers a unified diff from its hunk header and skips file headers', () => {
    const diff = diffFromText('--- a/x.ts\n+++ b/x.ts\n@@ -5,2 +5,2 @@\n ctx\n-gone\n+here')
    expect(diff?.lines).toEqual([{ k: 'ctx', n: 5, t: 'ctx' }, { k: 'del', n: 6, t: 'gone' }, { k: 'add', n: 6, t: 'here' }])
  })

  it('is null for empty text', () => {
    expect(diffFromText('')).toBeNull()
  })
})

describe('readers fill the diff', () => {
  it('Claude uses structuredPatch and its line for the open button', () => {
    const reader = new ClaudeChatReader()
    reader.feed(
      lines(
        { type: 'assistant', uuid: 'a', message: { content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' } }] } },
        { type: 'user', uuid: 'u', toolUseResult: { structuredPatch: [{ oldStart: 30, newStart: 30, lines: ['-x', '+y'] }] }, message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }] } }
      )
    )
    const [tool] = reader.items() as ChatTool[]
    expect(tool.diff?.lines[0]).toEqual({ k: 'del', n: 30, t: 'x' })
    expect(tool.line).toBe(30)
    expect(tool.path).toBe('src/a.ts')
  })

  it('Claude falls back to the input strings when there is no patch', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines({ type: 'assistant', uuid: 'a', message: { content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: 'n.ts', content: 'one\ntwo' } }] } }))
    const [tool] = reader.items() as ChatTool[]
    expect(tool.diff?.lines.map((l) => l.k)).toEqual(['add', 'add'])
  })

  it('Codex numbers a unified diff', () => {
    const reader = new CodexChatReader()
    reader.feed(
      lines({
        timestamp: '2026-10-26T21:21:04.857Z',
        type: 'event_msg',
        payload: { type: 'item_completed', item: { type: 'FileChange', id: 'f1', status: 'completed', changes: { 'a.ts': { type: 'update', unified_diff: '@@ -3,1 +3,1 @@\n-a\n+b' } } } }
      })
    )
    const [tool] = reader.items() as ChatTool[]
    expect(tool.diff?.lines).toEqual([{ k: 'del', n: 3, t: 'a' }, { k: 'add', n: 3, t: 'b' }])
  })
})
