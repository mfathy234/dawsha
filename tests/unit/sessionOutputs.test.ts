import { describe, expect, it } from 'vitest'
import { sessionOutputs } from '../../src/shared/sessionOutputs'
import { parseClaudeTimeline, parseCodexTimeline } from '../../src/shared/timelineParse'
import type { TimelineEvent } from '../../src/shared/timeline'

const edit = (at: number, path: string, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({ id: String(at), at, kind: 'edit', text: path, path, editStatus: 'succeeded', ...extra })
const read = (at: number, path: string): TimelineEvent => ({ id: String(at), at, kind: 'read', text: path, paths: [path] })

describe('sessionOutputs', () => {
  it('marks a file the session wrote whole as new and one it changed as edited', () => {
    const out = sessionOutputs([edit(1, 'C:/app/notes.md', { change: { pieces: [{ text: 'hi' }], whole: true } }), edit(2, 'C:/app/src/a.ts', { change: { pieces: [{ text: 'x' }] } })], 'C:/app')
    expect(out.map((o) => [o.path, o.kind])).toEqual([['src/a.ts', 'edited'], ['notes.md', 'new']])
  })

  it('lists newest first and keeps one row per file, new until the end', () => {
    const out = sessionOutputs([edit(1, 'a.md', { change: { pieces: [], whole: true } }), edit(3, 'b.md'), edit(5, 'a.md')], '')
    expect(out.map((o) => [o.path, o.kind, o.at])).toEqual([['a.md', 'new', 5], ['b.md', 'edited', 3]])
  })

  it('treats a whole-file write of a file it read first as an edit', () => {
    const out = sessionOutputs([read(1, '/p/a.md'), edit(2, '/p/a.md', { change: { pieces: [], whole: true } })], '/p')
    expect(out[0].kind).toBe('edited')
  })

  it('skips failed edits and files deleted last', () => {
    const out = sessionOutputs([edit(1, 'a.md', { editStatus: 'failed' }), edit(2, 'b.md'), edit(3, 'c.md', { change: { pieces: [], whole: true } }), edit(4, 'c.md', { change: { pieces: [], deleted: true } })], '')
    expect(out.map((o) => o.path)).toEqual(['b.md'])
  })

  it('splits the name from the folder and flags files outside the project', () => {
    const out = sessionOutputs([edit(1, 'C:/app/docs/plans/x.md'), edit(2, 'D:/other/y.md')], 'C:/app')
    expect(out.find((o) => o.name === 'x.md')).toMatchObject({ folder: 'docs/plans', inProject: true })
    expect(out.find((o) => o.name === 'y.md')).toMatchObject({ folder: 'D:/other', inProject: false })
  })

  it('reads a Claude log: Write is new, Edit is edited', () => {
    const lines = [
      { timestamp: '2026-10-29T10:00:00Z', type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/p/plan.md', content: '# Plan\n' } }] } },
      { timestamp: '2026-10-29T10:01:00Z', type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/p/src/a.ts', old_string: 'a', new_string: 'b' } }] } }
    ].map((line) => JSON.stringify(line)).join('\n')
    const out = sessionOutputs(parseClaudeTimeline(lines), '/p')
    expect(out.map((o) => [o.path, o.kind])).toEqual([['src/a.ts', 'edited'], ['plan.md', 'new']])
  })

  it('reads a Codex patch: Add is new, Update is edited, Delete is dropped', () => {
    const patch = '*** Begin Patch\n*** Add File: docs/n.md\n+x\n*** Update File: src/a.ts\n@@\n-o\n+n\n*** Delete File: old.md\n*** End Patch'
    const line = JSON.stringify({ timestamp: '2026-10-29T10:00:00Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c1', input: patch } })
    const out = sessionOutputs(parseCodexTimeline(line), '/p')
    expect(out.map((o) => [o.path, o.kind]).sort()).toEqual([['docs/n.md', 'new'], ['src/a.ts', 'edited']])
  })
})
