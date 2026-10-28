import { describe, expect, it } from 'vitest'
import { claudeActivity, codexActivity, mergeFiles, patchTouches } from '../../src/shared/agentActivity'
import { parseClaudeAgent, parseCodexAgent } from '../../src/shared/agentRecords'

const NOW = Date.parse('2026-10-28T12:00:00Z')
const at = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()
const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n')
const assistant = (minutes: number, ...content: unknown[]) => ({ type: 'assistant', timestamp: at(minutes), message: { id: `m${minutes}`, content } })
const tool = (name: string, input: unknown) => ({ type: 'tool_use', name, input })

describe('claudeActivity', () => {
  const records = [
    { type: 'user', timestamp: at(30), message: { role: 'user', content: 'Write tests for ThemeToggle.\nUse the helpers in src/test.' } },
    assistant(29, tool('Read', { file_path: '/repo/src/ThemeToggle.tsx' })),
    { type: 'user', timestamp: at(28), message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    assistant(27, tool('Write', { file_path: '/repo/src/ThemeToggle.test.tsx', content: 'a\nb\nc\n' })),
    assistant(26, tool('Edit', { file_path: '/repo/src/theme.tsx', old_string: 'x', new_string: 'x\ny\nz' })),
    assistant(25, tool('MultiEdit', { file_path: '/repo/src/theme.tsx', edits: [{ old_string: 'a\nb', new_string: 'c' }] })),
    assistant(24, tool('Bash', { command: 'rm src/old.ts -f && echo done' })),
    assistant(23, tool('Bash', { command: 'npm test' }))
  ]

  it('keeps the whole prompt with its line breaks', () => {
    expect(claudeActivity(records).prompt).toBe('Write tests for ThemeToggle.\nUse the helpers in src/test.')
  })

  it('lists tool calls newest first with a short argument and the time', () => {
    const { tools } = claudeActivity(records)
    expect(tools[0]).toEqual({ at: NOW - 23 * 60_000, name: 'Bash', brief: 'npm test' })
    expect(tools[1].brief).toBe('rm src/old.ts -f && echo done')
    expect(tools).toHaveLength(6)
  })

  it('keeps only the last eight calls', () => {
    const many = Array.from({ length: 12 }, (_, i) => assistant(20 - i, tool('Read', { file_path: `/r/f${i}` })))
    const { tools } = claudeActivity(many)
    expect(tools).toHaveLength(8)
    expect(tools[0].brief).toBe('/r/f11')
  })

  it('merges edits per file into A, M and D with line deltas', () => {
    expect(claudeActivity(records).files).toEqual([
      { path: '/repo/src/ThemeToggle.test.tsx', change: 'A', added: 3, removed: 0 },
      { path: '/repo/src/theme.tsx', change: 'M', added: 4, removed: 3 },
      { path: 'src/old.ts', change: 'D', added: null, removed: null }
    ])
  })

  it('degrades to empty values when the sample has nothing', () => {
    expect(claudeActivity([])).toEqual({ prompt: '', tools: [], files: [] })
  })
})

describe('mergeFiles', () => {
  it('lets a delete win and a re-created file become modified', () => {
    const touch = (change: 'A' | 'M' | 'D') => ({ path: 'p', change, added: null, removed: null })
    expect(mergeFiles([touch('M'), touch('D')])[0].change).toBe('D')
    expect(mergeFiles([touch('D'), touch('A')])[0].change).toBe('M')
    expect(mergeFiles([touch('A'), touch('M')])[0].change).toBe('A')
  })
})

describe('codexActivity', () => {
  const patch = '*** Begin Patch\n*** Add File: src/a.ts\n+one\n+two\n*** Update File: src/b.ts\n@@\n-old\n+new\n+newer\n*** Delete File: src/c.ts\n*** End Patch'
  const records = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Migrate the config' }] } },
    { type: 'response_item', timestamp: at(5), payload: { type: 'function_call', name: 'shell', arguments: '{"command":["npm","test"]}' } },
    { type: 'response_item', timestamp: at(4), payload: { type: 'custom_tool_call', name: 'apply_patch', input: patch } }
  ]

  it('reads the prompt, tool calls and apply_patch files', () => {
    const activity = codexActivity(records)
    expect(activity.prompt).toBe('Migrate the config')
    expect(activity.tools.map((call) => call.name)).toEqual(['apply_patch', 'shell'])
    expect(activity.tools[1].brief).toBe('npm test')
    expect(activity.files).toEqual([
      { path: 'src/a.ts', change: 'A', added: 2, removed: 0 },
      { path: 'src/b.ts', change: 'M', added: 2, removed: 1 },
      { path: 'src/c.ts', change: 'D', added: null, removed: null }
    ])
  })

  it('parses a patch on its own', () => {
    expect(patchTouches(patch)).toHaveLength(3)
  })
})

describe('parsers expose the activity', () => {
  it('Claude agents carry prompt, tools and files', () => {
    const text = lines(
      { type: 'user', timestamp: at(10), cwd: '/repo', message: { role: 'user', content: 'Do it' } },
      assistant(9, tool('Edit', { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' }))
    )
    const agent = parseClaudeAgent({ id: 'a', parentId: 'p', meta: {}, head: text, tail: '', whole: true, read: text.length, size: text.length, mtime: NOW - 60_000, fallbackStart: NOW, now: NOW })
    expect(agent.prompt).toBe('Do it')
    expect(agent.files).toEqual([{ path: '/repo/a.ts', change: 'M', added: 1, removed: 1 }])
    expect(agent.tools[0].name).toBe('Edit')
  })

  it('Codex agents carry them', () => {
    const meta = { type: 'session_meta', timestamp: at(10), payload: { id: 'c1', timestamp: at(10), cwd: '/repo', parent_thread_id: 'root', source: { subagent: { thread_spawn: { parent_thread_id: 'root' } } } } }
    const text = lines(meta, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix lint' }] } })
    const agent = parseCodexAgent({ head: text, tail: '', whole: true, read: text.length, size: text.length, mtime: NOW - 60_000, now: NOW })
    expect(agent?.prompt).toBe('Fix lint')
    expect(agent?.tools).toEqual([])
  })
})
