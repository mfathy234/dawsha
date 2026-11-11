import { describe, expect, it } from 'vitest'
import { closedSummary, needsAsk, sessionLine, sessionTime, spanShort, toolLineFromScreen, type SessionLineInput } from '../../src/shared/sessionLine'

const base: SessionLineInput = { state: 'working', ask: '', recap: '', tool: '', plan: '', changed: null, agents: 0 }

describe('needsAsk', () => {
  it('turns a command into a question', () => {
    expect(needsAsk({ tool: 'Bash', target: 'npm run migrate' }, '')).toBe('Run npm run migrate?')
  })
  it('names the file for edits', () => {
    expect(needsAsk({ tool: 'Edit', target: 'src/a.ts' }, '')).toBe('Edit src/a.ts?')
  })
  it('falls back to the approval card text', () => {
    expect(needsAsk({ tool: 'Requested action', target: '' }, 'Allow Claude to use the browser')).toBe('Allow Claude to use the browser')
  })
  it('is empty with nothing to say and clips long commands', () => {
    expect(needsAsk({ tool: 'Requested action', target: '' }, '')).toBe('')
    expect(needsAsk({ tool: 'Bash', target: 'x'.repeat(200) }, '').length).toBe(80)
  })
})

describe('sessionLine', () => {
  it('shows the ask for a waiting session', () => {
    expect(sessionLine({ ...base, state: 'needs', ask: 'Run npm test?' })).toBe('Run npm test?')
    expect(sessionLine({ ...base, state: 'needs' })).toBe('Needs you')
  })
  it('counts changed files when done', () => {
    expect(sessionLine({ ...base, state: 'done', changed: 4 })).toBe('Done · 4 files changed')
    expect(sessionLine({ ...base, state: 'done', changed: 1 })).toBe('Done · 1 file changed')
    expect(sessionLine({ ...base, state: 'done', changed: 0 })).toBe('Done')
  })
  it('prefers the recap, then the tool line, then the state word', () => {
    expect(sessionLine({ ...base, recap: 'Sorting rows', tool: 'Running npm test' })).toBe('Sorting rows')
    expect(sessionLine({ ...base, tool: 'Running npm test' })).toBe('Running npm test')
    expect(sessionLine(base)).toBe('Working')
    expect(sessionLine({ ...base, agents: 2 })).toBe('Working · 2 agents')
    expect(sessionLine({ ...base, state: 'idle' })).toBe('Idle')
  })
  it('puts the plan first while one is active', () => {
    expect(sessionLine({ ...base, plan: '3 of 7', tool: 'Running npm test' })).toBe('3 of 7 · Running npm test')
    expect(sessionLine({ ...base, state: 'done', plan: '3 of 7', changed: 2 })).toBe('Done · 2 files changed')
  })
})

describe('spanShort and sessionTime', () => {
  it('is quiet for the first seconds and never says now', () => {
    expect(spanShort(4_000)).toBe('')
    expect(spanShort(12_000)).toBe('10s')
    expect(spanShort(59_000)).toBe('50s')
    expect(spanShort(2 * 60_000)).toBe('2m')
    expect(spanShort(3 * 3_600_000)).toBe('3h')
    expect(spanShort(72 * 3_600_000)).toBe('3d')
  })
  it('shows time only for working, waiting and done sessions', () => {
    expect(sessionTime('working', 0, 120_000)).toBe('2m')
    expect(sessionTime('needs', 0, 120_000)).toBe('2m')
    expect(sessionTime('done', 0, 180_000)).toBe('3m')
    expect(sessionTime('idle', 0, 180_000)).toBe('')
  })
})

describe('toolLineFromScreen', () => {
  it('reads the last tool call', () => {
    expect(toolLineFromScreen('● Bash(npm test)\n  ⎿ ok\n● Update(src/a.ts)\n')).toBe('Editing src/a.ts')
    expect(toolLineFromScreen('⏺ Bash(npm run build)')).toBe('Running npm run build')
  })
  it('names unknown tools and ignores prose', () => {
    expect(toolLineFromScreen('● Frobnicate(x)')).toBe('Running Frobnicate')
    expect(toolLineFromScreen('● I fixed the import.')).toBe('')
  })
})

describe('closedSummary', () => {
  const noon = new Date(2026, 10, 11, 12).getTime()
  it('says today only when all closed today', () => {
    expect(closedSummary([noon - 1000, noon - 5000], noon)).toBe('2 closed today')
    expect(closedSummary([noon - 1000, noon - 2 * 86_400_000], noon)).toBe('2 closed')
    expect(closedSummary([], noon)).toBe('')
  })
})
