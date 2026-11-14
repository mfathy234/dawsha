import { describe, expect, it } from 'vitest'
import { claudeDetail, codexDetail, geminiDetail, modelLabel } from '../../src/shared/sessionDetail'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n')

describe('claudeDetail', () => {
  it('reads first prompt, last reply, model, start and message count', () => {
    const text = lines(
      { type: 'user', timestamp: '2026-10-08T09:12:00.000Z', message: { role: 'user', content: 'Add a dark mode toggle' } },
      { type: 'user', isMeta: true, message: { content: 'caveat' } },
      { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'First reply' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } },
      { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Edit' }] } },
      { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'The toggle   now lives\nin Settings.' }] } }
    )
    expect(claudeDetail(text)).toEqual({
      firstPrompt: 'Add a dark mode toggle',
      lastAssistant: 'The toggle now lives in Settings.',
      model: 'claude-opus-5-5',
      startedAt: Date.parse('2026-10-08T09:12:00.000Z'),
      messages: 3
    })
  })

  it('scales the count for sampled files and survives garbage', () => {
    const text = `${lines({ type: 'user', message: { content: 'hi' } })}\nnot json\n{"type":"assis`
    expect(claudeDetail(text, 10).messages).toBe(10)
    expect(claudeDetail('').messages).toBe(0)
  })

  it('skips command lines as prompts', () => {
    const text = lines({ type: 'user', message: { content: '<command-name>/clear</command-name>' } })
    expect(claudeDetail(text).firstPrompt).toBeUndefined()
  })
})

describe('codexDetail', () => {
  it('keeps the full first real message when requested for titles', () => {
    const prompt = 'Please fix the login problem and add regression tests. '.repeat(200)
    expect(codexDetail(lines({ type: 'event_msg', payload: { type: 'user_message', message: prompt } }), 1, true).firstPrompt).toBe(prompt.trim())
  })
  it('prefers event messages and reads the model from the turn context', () => {
    const text = lines(
      { type: 'session_meta', payload: { id: 'i', cwd: 'C:\\x', timestamp: '2026-10-08T12:00:00.000Z' } },
      { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Fix the flaky login test' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'Replacing the sleep.' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ignored duplicate' }] } }
    )
    expect(codexDetail(text)).toEqual({
      startedAt: Date.parse('2026-10-08T12:00:00.000Z'),
      model: 'gpt-5.6-sol',
      firstPrompt: 'Fix the flaky login test',
      lastAssistant: 'Replacing the sleep.',
      messages: 2
    })
  })

  it('falls back to response items and skips environment context', () => {
    const text = lines(
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Update dependencies' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } }
    )
    const detail = codexDetail(text)
    expect(detail.firstPrompt).toBe('Update dependencies')
    expect(detail.lastAssistant).toBe('Done.')
    expect(detail.messages).toBe(2)
  })
})

describe('geminiDetail', () => {
  it('counts real prompts and replies', () => {
    const text = lines(
      { sessionId: 's', startTime: '2026-10-08T12:00:00.000Z' },
      { id: 'm1', type: 'user', content: [{ text: '/help' }] },
      { id: 'm2', type: 'user', content: [{ text: 'Rewrite the guide' }] },
      { id: 'm3', type: 'gemini', content: 'Done.', model: 'gemini-2.5-pro' },
      { $set: { lastUpdated: '2026-10-08T12:01:00.000Z' } }
    )
    expect(geminiDetail(text)).toEqual({
      startedAt: Date.parse('2026-10-08T12:00:00.000Z'),
      firstPrompt: 'Rewrite the guide',
      lastAssistant: 'Done.',
      model: 'gemini-2.5-pro',
      messages: 2
    })
  })
})

describe('modelLabel', () => {
  it('shortens Claude families and leaves other models alone', () => {
    expect(modelLabel('claude', 'claude-opus-5-5')).toBe('Opus')
    expect(modelLabel('claude', 'something-else')).toBe('something-else')
    expect(modelLabel('codex', 'gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(modelLabel('gemini', undefined)).toBeUndefined()
  })
})
