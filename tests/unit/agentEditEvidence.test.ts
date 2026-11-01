import { expect, it } from 'vitest'
import { createLineParser, parseGeminiTimeline } from '../../src/shared/timelineParse'

const timestamp = '2026-11-01T10:00:00Z'
const call = (id: string) => JSON.stringify({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: 'a.ts', old_string: 'old', new_string: 'new' } }] } }) + '\n'
const result = (id: string, failed: boolean) => JSON.stringify({ type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: failed ? 'Permission denied' : 'success' }] } }) + '\n'
it('distinguishes attempted, failed and confirmed edits across incremental transcript reads', () => {
  const parser = createLineParser('claude')
  parser.feed(call('first'))
  expect(parser.events().find(event => event.kind === 'edit')).toMatchObject({ editStatus: 'pending' })
  parser.feed(result('first', true))
  expect(parser.events().find(event => event.kind === 'edit')).toMatchObject({ editStatus: 'failed' })
  parser.feed(call('second') + result('second', false))
  expect(parser.events().filter(event => event.kind === 'edit').map(event => event.editStatus)).toEqual(['failed', 'succeeded'])
})
it('does not mark an incomplete Gemini call as a completed edit', () => {
  const log = JSON.stringify({ sessionId: 's1', messages: [{ type: 'gemini', timestamp, toolCalls: [{ name: 'write_file', args: { file_path: 'a.ts', content: 'new' }, status: 'executing' }] }] })
  expect(parseGeminiTimeline(log).find(event => event.kind === 'edit')).toMatchObject({ editStatus: 'pending' })
})
it('does not treat a Codex apply_patch error response as a successful edit', () => {
  const parser = createLineParser('codex')
  parser.feed(JSON.stringify({ type: 'response_item', timestamp, payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch', input: '*** Begin Patch\n*** Update File: a.ts\n-old\n+new\n*** End Patch' } }) + '\n')
  parser.feed(JSON.stringify({ type: 'response_item', timestamp, payload: { type: 'custom_tool_call_output', call_id: 'patch', output: 'apply_patch verification failed: could not find expected lines' } }) + '\n')
  expect(parser.events().find(event => event.kind === 'edit')).toMatchObject({ editStatus: 'failed' })
})
