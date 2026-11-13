import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../src/shared/chatLog'
import { activeMoment, changesLabel, doneLine, DONE_MOMENT_MS, lastExchange, nowLine, replyLines, stepDoneMemory, usageLine, type DoneMemory } from '../../src/shared/miniDetail'
import { isMiniAction, miniSession, type MiniSessionInput } from '../../src/shared/miniWindow'

const message = (id: string, role: 'user' | 'agent', text: string): ChatItem => ({ kind: 'message', id, role, text })
const input = (patch: Partial<MiniSessionInput> = {}): MiniSessionInput => ({
  paneId: 'a', agent: 'claude', title: 'Test', project: 'Smoke', status: 'idle', attention: 'none',
  tail: '', recap: '', tool: '', idleFor: '', changed: null, todos: [], ...patch
})
const now = (patch: Partial<Parameters<typeof nowLine>[0]>): string => nowLine({ state: 'working', ask: '', tool: '', step: '', elapsed: '', ...patch })

describe('the Now line', () => {
  it('says what a working session is doing with the time, falling back to its plan step and then Thinking', () => {
    expect(now({ tool: 'Running npm test', elapsed: '40s' })).toBe('Running npm test, 40s')
    expect(now({ step: 'Write the docs' })).toBe('Write the docs')
    expect(now({ elapsed: '10s' })).toBe('Thinking, 10s')
  })
  it('says what a waiting session asks, how long ago it finished, and when it is idle or gone', () => {
    expect(now({ state: 'needs', ask: 'Run npm run migrate?' })).toBe('Waiting for you: Run npm run migrate?')
    expect(now({ state: 'needs' })).toBe('Waiting for you')
    expect(now({ state: 'done', elapsed: '3m' })).toBe('Done 3m ago')
    expect(now({ state: 'done' })).toBe('Done just now')
    expect(now({ state: 'idle', elapsed: '5m' })).toBe('Idle 5m')
    expect(now({ state: 'exited' })).toBe('Exited')
  })
  it('is part of the shaped session, built from the tool and the elapsed time', () => {
    expect(miniSession(input({ status: 'busy', tool: 'Editing src/a.ts', elapsed: '20s' })).now).toBe('Editing src/a.ts, 20s')
  })
})

describe('the last exchange in a session log', () => {
  it('takes the last message the person sent and the last reply', () => {
    const items = [message('1', 'user', 'first'), message('2', 'agent', 'old reply'), message('3', 'user', 'Move the\ntotals  now'), message('4', 'agent', 'Moved them.\n\nAll tests pass.')]
    expect(lastExchange(items)).toEqual({ asked: 'Move the totals now', reply: ['Moved them.', 'All tests pass.'] })
  })
  it('keeps the last reply when a newer message has not been answered yet, and skips tools', () => {
    const tool = { kind: 'tool', id: 't', activity: 'run', verb: 'Run', target: 'ls', output: '', outputTruncated: false, done: true } as unknown as ChatItem
    const items: ChatItem[] = [message('1', 'agent', 'Done with that.'), message('2', 'user', 'Now the docs'), tool]
    expect(lastExchange(items)).toEqual({ asked: 'Now the docs', reply: ['Done with that.'] })
  })
  it('is empty with no messages', () => {
    expect(lastExchange([])).toEqual({ asked: '', reply: [] })
  })
  it('shows a reply as plain text, three lines at most, without code blocks or markdown marks', () => {
    const text = '## Result\n\n- **Fixed** the `parser`\n```ts\nconst x = 1\n```\nSee [the docs](http://x.y) for more\nA fourth line'
    expect(replyLines(text)).toEqual(['Result', 'Fixed the parser', 'See the docs for more'])
  })
  it('bounds a very long message', () => {
    expect(lastExchange([message('1', 'user', 'x'.repeat(5000))]).asked.length).toBeLessThanOrEqual(400)
    expect(replyLines('y'.repeat(900))[0].length).toBeLessThanOrEqual(200)
  })
})

describe('changes and usage lines', () => {
  it('writes files with added and removed lines', () => {
    expect(changesLabel({ files: 3, added: 69, removed: 3 })).toBe('3 files +69 -3')
    expect(changesLabel({ files: 1, added: 2, removed: 0 })).toBe('1 file +2 -0')
  })
  it('writes context and cost on one line, only what is known', () => {
    expect(usageLine(41, 0.62)).toBe('Context 41%, $0.62')
    expect(usageLine(41, null)).toBe('Context 41%')
    expect(usageLine(null, 1.5)).toBe('$1.50')
    expect(usageLine(null, 0)).toBe('')
    expect(usageLine(null, 0.004)).toBe('under $0.01')
  })
  it('shapes changes only when files changed, and the usage line', () => {
    expect(miniSession(input({ changes: { files: 0, added: 0, removed: 0 } })).changes).toBeNull()
    const session = miniSession(input({ changes: { files: 3, added: 69, removed: 3 }, context: 41, costUsd: 0.62 }))
    expect(session.changes).toEqual({ files: 3, added: 69, removed: 3 })
    expect(session.usage).toBe('Context 41%, $0.62')
  })
})

describe('the done moment', () => {
  type Step = ['working' | 'done' | 'idle' | 'needs' | 'exited', number]
  const run = (steps: Step[]): DoneMemory | undefined => {
    let memory: DoneMemory | undefined
    for (const [state, at] of steps) memory = stepDoneMemory(memory, state, at)
    return memory
  }
  it('starts when working turns to done and says how long the work took', () => {
    const memory = run([['working', 1000], ['working', 100_000], ['done', 181_000]])
    expect(memory?.moment).toEqual({ at: 181_000, took: 180_000 })
    expect(activeMoment(memory, 182_000)).toEqual({ took: '3m' })
  })
  it('lasts about 30 seconds, then the card keeps plain Done', () => {
    const memory = run([['working', 0], ['done', 60_000]])
    expect(activeMoment(memory, 60_000 + DONE_MOMENT_MS - 1)).not.toBeNull()
    expect(activeMoment(memory, 60_000 + DONE_MOMENT_MS)).toBeNull()
  })
  it('counts the time a session waited for an answer as work, and clears when it leaves done', () => {
    const memory = run([['working', 0], ['needs', 30_000], ['working', 40_000], ['done', 100_000]])
    expect(memory?.moment?.took).toBe(100_000)
    expect(run([['working', 0], ['done', 5000], ['idle', 9000]])?.moment).toBeNull()
  })
  it('is not set for a session that was already done, or never worked', () => {
    expect(run([['done', 0], ['done', 1000]])?.moment).toBeNull()
    expect(run([['idle', 0], ['done', 1000]])?.moment).toBeNull()
    expect(activeMoment(undefined, 0)).toBeNull()
  })
  it('words the card line with the time and the changed files', () => {
    expect(doneLine('3m', 4)).toBe('Done in 3m, 4 files')
    expect(doneLine('', 1)).toBe('Done, 1 file')
    expect(doneLine('2m', 0)).toBe('Done in 2m')
    const session = miniSession(input({ attention: 'done', changed: 4, moment: { took: '3m' } }))
    expect(session.line).toBe('Done in 3m, 4 files')
    expect(session.fresh).toBe(true)
    expect(miniSession(input({ attention: 'done', changed: 4 })).fresh).toBe(false)
    expect(miniSession(input({ attention: 'done', changed: 0, moment: { took: '3m' } })).fresh).toBe(false)
  })
})

describe('Mini actions for review and send', () => {
  it('accepts a review and a bounded, non-empty message', () => {
    expect(isMiniAction({ kind: 'review', paneId: 'a' })).toBe(true)
    expect(isMiniAction({ kind: 'send', paneId: 'a', text: 'hello' })).toBe(true)
    expect(isMiniAction({ kind: 'send', paneId: 'a', text: '   ' })).toBe(false)
    expect(isMiniAction({ kind: 'send', paneId: 'a', text: 'x'.repeat(8001) })).toBe(false)
    expect(isMiniAction({ kind: 'send', paneId: 'a', text: 'hi', extra: 1 })).toBe(false)
    expect(isMiniAction({ kind: 'send', paneId: 'a' })).toBe(false)
    expect(isMiniAction({ kind: 'review', paneId: 'a', path: 'x' })).toBe(false)
  })
})
