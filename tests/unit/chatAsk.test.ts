import { describe, expect, it } from 'vitest'
import { parseAskQuestions, type AskQuestion } from '../../src/shared/chatAsk'
import type { ChatItem } from '../../src/shared/chatLog'
import { isAnswered, planAnswers, planQuestion, submitSteps } from '../../src/shared/menuAnswer'
import { askPromptFor, parseMenuPrompt, submitRowNumber } from '../../src/shared/menuPrompt'
import { ClaudeChatReader } from '../../src/main/chatLog/claudeReader'
import type { ChatTool } from '../../src/shared/chatLog'

const input = {
  questions: [
    { question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue', description: 'Cool' }] },
    { question: 'Which sizes?', header: 'Size', multiSelect: true, options: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }
  ]
}

const SCREEN = `
────────────────────────────
← ☐ Color  ✔ Submit →

Which color?

❯ 1. Red
     Warm
  2. Blue
     Cool
  3. Type something.
────────────────────────────
  4. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`

describe('parseAskQuestions', () => {
  it('reads questions and numbers the options from 1', () => {
    const [color, size] = parseAskQuestions(input)
    expect(color).toMatchObject({ question: 'Which color?', header: 'Color', multiSelect: false, otherNumber: 3 })
    expect(color.options.map((option) => option.number)).toEqual([1, 2])
    expect(size.multiSelect).toBe(true)
    expect(size.options[0].description).toBe('')
  })

  it('shows nothing when one question is unreadable', () => {
    expect(parseAskQuestions({ questions: [input.questions[0], { question: '', options: [] }] })).toEqual([])
    expect(parseAskQuestions({})).toEqual([])
    expect(parseAskQuestions('x')).toEqual([])
  })

  it('is kept on the tool row by the Claude reader', () => {
    const reader = new ClaudeChatReader()
    reader.feed(JSON.stringify({ type: 'assistant', uuid: 'q', message: { content: [{ type: 'tool_use', id: 'q', name: 'AskUserQuestion', input }] } }) + '\n')
    const tool = reader.items()[0] as ChatTool
    expect(tool.activity).toBe('question')
    expect(tool.verb).toBe('Asked')
    expect(tool.target).toBe('Which color?')
    expect(tool.ask).toHaveLength(2)
  })

  it('names an MCP tool by server and tool', () => {
    const reader = new ClaudeChatReader()
    reader.feed(JSON.stringify({ type: 'assistant', uuid: 'm', message: { content: [{ type: 'tool_use', id: 'm', name: 'mcp__github__list_issues', input: {} }] } }) + '\n')
    const tool = reader.items()[0] as ChatTool
    expect([tool.activity, tool.verb, tool.target]).toEqual(['mcp', 'github', 'list_issues'])
  })
})

describe('parseMenuPrompt', () => {
  it('reads the question and options, with Other apart and Chat about this dropped', () => {
    const prompt = parseMenuPrompt(SCREEN)
    expect(prompt?.questions[0].question).toBe('Which color?')
    expect(prompt?.questions[0].options.map((option) => [option.number, option.label, option.description])).toEqual([
      [1, 'Red', 'Warm'],
      [2, 'Blue', 'Cool']
    ])
    expect(prompt?.questions[0].otherNumber).toBe(3)
  })

  it('shows a titled picker such as a model list, since it waits on the user too', () => {
    const screen = [' Select model', ' ❯ 1. Default', '   2. Sonnet', '   3. Haiku', ' Enter to confirm · Esc to exit'].join('\n')
    const prompt = parseMenuPrompt(screen)
    expect(prompt?.questions[0].question).toBe('Select model')
    expect(prompt?.questions[0].options.map((option) => option.label)).toEqual(['Default', 'Sonnet', 'Haiku'])
  })

  it('shows the Codex update screen', () => {
    const screen = [
      '  ✨ Update available! 0.163.0 -> 0.166.0',
      '  Release notes: https://github.com/openai/codex/releases/latest',
      '› 1. Update now (runs `npm install -g @openai/codex`)',
      '  2. Skip',
      '  3. Skip until next version',
      '  Press enter to continue · esc skip'
    ].join('\n')
    const prompt = parseMenuPrompt(screen)
    expect(prompt?.questions[0].options.map((option) => option.number)).toEqual([1, 2, 3])
    expect(prompt?.questions[0].question).toContain('Update available')
  })

  it('still ignores a plain numbered list in a reply', () => {
    expect(parseMenuPrompt('Steps\n1. Build it\n2. Test it\n3. Ship it')).toBeNull()
  })

  it('needs two numbered rows', () => {
    expect(parseMenuPrompt('Pick\n1. Only one\nEnter to select')).toBeNull()
    expect(parseMenuPrompt('no menu here')).toBeNull()
  })

  it('uses the last run when older ones are on screen', () => {
    const prompt = parseMenuPrompt('Old?\n1. a\n2. b\nNew?\n1. c\n2. d')
    expect(prompt?.questions[0].options.map((option) => option.label)).toEqual(['c', 'd'])
    expect(prompt?.questions[0].question).toBe('New?')
  })

  it('finds the submit row of a review screen', () => {
    expect(submitRowNumber('Ready to submit?\n❯ 1. Submit answers\n  2. Cancel')).toBe(1)
    expect(submitRowNumber(SCREEN)).toBeNull()
  })
})

describe('askPromptFor', () => {
  const open: ChatItem = { kind: 'tool', id: 'q1', activity: 'question', verb: 'Asked', target: '', output: '', outputTruncated: false, done: false, ask: parseAskQuestions(input) }

  it('prefers the logged call when its options are on screen', () => {
    expect(askPromptFor([open], SCREEN)?.id).toBe('q1')
    expect(askPromptFor([open], SCREEN)?.questions).toHaveLength(2)
  })

  it('falls back to the screen when the call is done or not the one shown', () => {
    expect(askPromptFor([{ ...open, done: true } as ChatItem], SCREEN)?.id.startsWith('screen:')).toBe(true)
    expect(askPromptFor([open], 'Pick one?\n1. Apple\n2. Pear\nEnter to select')?.id.startsWith('screen:')).toBe(true)
  })
})

describe('answers', () => {
  const [single, many] = parseAskQuestions(input) as [AskQuestion, AskQuestion]
  const keys = (steps: { data: string }[]): string[] => steps.map((step) => step.data)

  it('presses the number of a single choice', () => {
    expect(keys(planQuestion(single, { numbers: [2], other: '' }))).toEqual(['2'])
  })

  it('types text for the Other row', () => {
    expect(keys(planQuestion(single, { numbers: [], other: ' green\nish ' }))).toEqual(['3', 'green ish', '\r'])
  })

  it('walks with arrows and Space for many choices', () => {
    expect(keys(planQuestion(many, { numbers: [3, 1], other: '' }))).toEqual([' ', '\u001b[B', '\u001b[B', ' ', '\r'])
  })

  it('uses arrows and Enter past nine rows', () => {
    const wide: AskQuestion = { ...single, options: Array.from({ length: 11 }, (_, i) => ({ number: i + 1, label: `o${i}`, description: '' })) }
    const steps = keys(planQuestion(wide, { numbers: [11], other: '' }))
    expect(steps.filter((key) => key === '\u001b[B')).toHaveLength(10)
    expect(steps[steps.length - 1]).toBe('\r')
  })

  it('plans every question and pauses after each', () => {
    const steps = planAnswers([single, many], [{ numbers: [1], other: '' }, { numbers: [2], other: '' }])
    expect(steps[0].wait).toBeGreaterThan(100)
    expect(keys(steps)).toEqual(['1', '\u001b[B', ' ', '\r'])
  })

  it('knows when every question has an answer', () => {
    expect(isAnswered([single, many], [{ numbers: [1], other: '' }])).toBe(false)
    expect(isAnswered([single, many], [{ numbers: [1], other: '' }, { numbers: [], other: '' }])).toBe(false)
    expect(isAnswered([single, many], [{ numbers: [], other: 'x' }, { numbers: [1], other: '' }])).toBe(true)
    expect(isAnswered([], [])).toBe(false)
  })

  it('confirms a review screen by its number', () => {
    expect(keys(submitSteps(1))).toEqual(['1'])
  })
})
