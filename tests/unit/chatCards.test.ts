import { describe, expect, it } from 'vitest'
import { ClaudeChatReader } from '../../src/main/chatLog/claudeReader'
import { PLAN_MAX, parseAnswers, parsePlan, parseTodos, todoSummary } from '../../src/shared/chatCards'
import type { ChatTool } from '../../src/shared/chatLog'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
const call = (id: string, name: string, input: unknown) => ({ type: 'assistant', uuid: `a-${id}`, message: { content: [{ type: 'tool_use', id, name, input }] } })
const result = (id: string, content: unknown, toolUseResult?: unknown) => ({ type: 'user', uuid: `u-${id}`, ...(toolUseResult ? { toolUseResult } : {}), message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } })

describe('parseTodos', () => {
  it('reads tasks and their states, and drops what has no text', () => {
    const todos = parseTodos({ todos: [{ content: 'Write tests', status: 'completed', activeForm: 'Writing tests' }, { content: 'Ship', status: 'in_progress' }, { content: '', activeForm: '' }, { content: 'Later', status: 'odd' }, 5] })
    expect(todos).toEqual([{ text: 'Write tests', status: 'completed' }, { text: 'Ship', status: 'in_progress' }, { text: 'Later', status: 'pending' }])
    expect(todoSummary(todos)).toBe('1 of 3 done')
  })

  it('is empty for anything else', () => {
    expect(parseTodos(null)).toEqual([])
    expect(parseTodos({ todos: 'x' })).toEqual([])
  })
})

describe('parseAnswers', () => {
  it('pairs each question with the chosen label, joining several', () => {
    expect(parseAnswers({ answers: { 'Which library?': 'zod', 'Which checks?': ['lint', 'types'] } })).toEqual([
      { question: 'Which library?', answer: 'zod' },
      { question: 'Which checks?', answer: 'lint, types' }
    ])
  })

  it('ignores a result with no answers', () => {
    expect(parseAnswers({})).toEqual([])
    expect(parseAnswers(undefined)).toEqual([])
  })
})

describe('parsePlan', () => {
  it('returns the plan text, bounded', () => {
    expect(parsePlan({ plan: '  # Plan\n- one ' })).toBe('# Plan\n- one')
    expect(parsePlan({ plan: 'x'.repeat(PLAN_MAX + 10) })).toHaveLength(PLAN_MAX)
    expect(parsePlan({})).toBe('')
  })
})

describe('tool cards from a Claude log', () => {
  it('TodoWrite carries its checklist', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines(call('t1', 'TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'pending' }] }), result('t1', 'ok')))
    const [tool] = reader.items() as ChatTool[]
    expect(tool).toMatchObject({ verb: 'Todos', target: '1 of 2 done', done: true })
    expect(tool.todos).toHaveLength(2)
  })

  it('AskUserQuestion keeps the questions and gains the answers from toolUseResult', () => {
    const reader = new ClaudeChatReader()
    const questions = [{ header: 'Lib', question: 'Which library?', multiSelect: false, options: [{ label: 'zod', description: 'a' }, { label: 'yup', description: 'b' }] }]
    reader.feed(lines(call('q1', 'AskUserQuestion', { questions }), result('q1', 'User answered', { questions, answers: { 'Which library?': 'zod' } })))
    const [tool] = reader.items() as ChatTool[]
    expect(tool.ask).toHaveLength(1)
    expect(tool.answers).toEqual([{ question: 'Which library?', answer: 'zod' }])
  })

  it('ExitPlanMode carries the plan', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines(call('p1', 'ExitPlanMode', { plan: '# Do it\n1. step' }), result('p1', 'approved')))
    const [tool] = reader.items() as ChatTool[]
    expect(tool.plan).toBe('# Do it\n1. step')
    expect(tool.verb).toBe('Plan')
  })

  it('a sub-agent row shows its description and keeps the final report as output', () => {
    const reader = new ClaudeChatReader()
    reader.feed(lines(call('g1', 'Task', { description: 'Find the flaky test', subagent_type: 'general-purpose', prompt: 'A very long prompt that must not be the label' }), result('g1', [{ type: 'text', text: 'Found it in login.spec.ts' }])))
    const [tool] = reader.items() as ChatTool[]
    expect(tool).toMatchObject({ activity: 'agent', verb: 'Agent', target: 'Find the flaky test', output: 'Found it in login.spec.ts', done: true })
  })
})
