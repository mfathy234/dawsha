import { describe, expect, it } from 'vitest'
import {
  blockAtRow,
  blockMarkdown,
  failureMessage,
  filterOutline,
  formatDuration,
  longBlockPosition,
  outlineEntries,
  parseBlocks,
  parseDuration,
  promptAboveRow,
  stepBlock
} from '../../src/shared/terminalBlocks'
import { CLAUDE_SESSION, CODEX_SESSION, PERMISSION_SESSION, toLines } from '../support/blockFixtures'

const claudeLines = toLines(CLAUDE_SESSION)
const liveFromRow = claudeLines.findIndex((line) => line.text.startsWith('╭'))

describe('parseBlocks with Claude Code output', () => {
  const blocks = parseBlocks(claudeLines, { agent: 'claude', liveFromRow })

  it('splits prompts, tool calls and replies', () => {
    expect(blocks.map((block) => [block.kind, block.title])).toEqual([
      ['prompt', 'run the unit tests and fix what fails'],
      ['tool', 'npm test'],
      ['tool', 'sed -n 180,240p tests/unit/miniWindow.test.ts'],
      ['tool', 'Update src/renderer/mini/detail.ts'],
      ['reply', 'The detail view rendered before the session state arrived. It now waits.'],
      ['tool', 'npm test -- miniWindow']
    ])
  })

  it('marks a failing command with its error lines and duration', () => {
    const failed = blocks[1]
    expect(failed.status).toBe('failed')
    expect(failed.durationMs).toBe(8200)
    expect(failed.errors.some((error) => error.text.includes('miniWindow.test.ts'))).toBe(true)
    expect(failed.errors.length).toBeGreaterThan(1)
  })

  it('keeps passing commands ok and the input box out of every block', () => {
    expect(blocks[2].status).toBe('ok')
    expect(blocks[5].status).toBe('ok')
    expect(blocks.at(-1)?.endRow).toBeLessThan(liveFromRow)
  })

  it('opens diffs and counts their changes', () => {
    expect(blocks[3].diff).toBe(true)
    expect(blocks[3].detail).toBe('+2 −1')
  })

  it('marks only the last block running while the agent works', () => {
    const running = parseBlocks(claudeLines, { agent: 'claude', liveFromRow, running: true })
    expect(running.filter((block) => block.status === 'running')).toHaveLength(1)
    expect(running.at(-1)?.status).toBe('running')
  })
})

describe('parseBlocks with Codex output', () => {
  const blocks = parseBlocks(toLines(CODEX_SESSION), { agent: 'codex' })

  it('reads Ran, Edited and replies', () => {
    expect(blocks.map((block) => [block.kind, block.title])).toEqual([
      ['prompt', 'fix the flaky mini window test'],
      ['tool', 'Explored'],
      ['tool', 'npm test'],
      ['tool', 'Edited src/renderer/mini/detail.ts (+6 -2)'],
      ['reply', 'All tests pass now.']
    ])
    expect(blocks[2].status).toBe('failed')
    expect(blocks[3].diff).toBe(true)
  })
})

describe('parseBlocks other sources', () => {
  it('starts a question block at a permission prompt', () => {
    const blocks = parseBlocks(toLines(PERMISSION_SESSION), { agent: 'claude' })
    expect(blocks.at(-1)).toMatchObject({ kind: 'question', title: 'Do you want to proceed?' })
  })

  it('does not treat numbered options as prompts', () => {
    const blocks = parseBlocks(toLines('Do you want to proceed?\n❯ 1. Yes\n  2. No'), { agent: 'claude' })
    expect(blocks).toHaveLength(1)
  })

  it('uses commands that shell integration marked', () => {
    const lines = toLines('git pull\nAlready up to date.\nnpm run build\nerror: boom')
    const blocks = parseBlocks(lines, {
      agent: 'shell',
      commands: [{ row: 0, title: 'git pull', exitCode: 0 }, { row: 2, title: 'npm run build', exitCode: 1 }]
    })
    expect(blocks.map((block) => [block.kind, block.title, block.status])).toEqual([
      ['command', 'git pull', 'ok'],
      ['command', 'npm run build', 'failed']
    ])
  })

  it('takes rows from the prompt markers as prompts', () => {
    const blocks = parseBlocks(toLines('hello there\nreply'), { promptRows: new Set([0]) })
    expect(blocks[0]).toMatchObject({ kind: 'prompt', title: 'hello there' })
  })

  it('counts wrapped rows into the end row', () => {
    const blocks = parseBlocks([{ row: 0, rows: 3, text: '$ npm test' }], { agent: 'shell' })
    expect(blocks[0]).toMatchObject({ startRow: 0, endRow: 2 })
  })

  it('ignores text before the first block', () => {
    expect(parseBlocks(toLines('welcome\n\nloading'), { agent: 'claude' })).toEqual([])
  })
})

describe('parseDuration and formatDuration', () => {
  it('reads common duration words', () => {
    expect(parseDuration('Done in 4.2s')).toBe(4200)
    expect(parseDuration('Duration 1.4s')).toBe(1400)
    expect(parseDuration('took 2m')).toBe(120000)
    expect(parseDuration('nothing here')).toBeNull()
  })

  it('formats it briefly', () => {
    expect(formatDuration(400)).toBe('400ms')
    expect(formatDuration(8200)).toBe('8.2s')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(192_000)).toBe('3m 12s')
  })
})

describe('block navigation', () => {
  const blocks = parseBlocks(claudeLines, { agent: 'claude', liveFromRow })

  it('finds the block at a row and steps between blocks', () => {
    const second = blocks[1]
    expect(blockAtRow(blocks, second.startRow + 1)).toBe(second)
    expect(stepBlock(blocks, second.startRow, 1)).toBe(blocks[2])
    expect(stepBlock(blocks, second.startRow, -1)).toBe(blocks[0])
    expect(stepBlock(blocks, 0, -1)).toBeNull()
  })

  it('reports a position only inside blocks taller than the viewport', () => {
    const second = blocks[1]
    expect(longBlockPosition(blocks, second.startRow + 2, 3)?.line).toBe(3)
    expect(longBlockPosition(blocks, second.startRow + 2, 40)).toBeNull()
  })

  it('finds the prompt the output answers', () => {
    expect(promptAboveRow(blocks, blocks[3].startRow)?.title).toContain('run the unit tests')
  })
})

describe('outline and copy', () => {
  const blocks = parseBlocks(claudeLines, { agent: 'claude', liveFromRow })

  it('lists prompts, commands and each failure', () => {
    const entries = outlineEntries(blocks)
    expect(entries.some((entry) => entry.kind === 'error')).toBe(true)
    expect(entries[0].kind).toBe('prompt')
    expect(entries.find((entry) => entry.title === 'npm test')?.status).toBe('failed')
  })

  it('filters by words', () => {
    const entries = outlineEntries(blocks)
    expect(filterOutline(entries, 'failed npm').every((entry) => entry.status === 'failed')).toBe(true)
    expect(filterOutline(entries, 'zzz')).toEqual([])
    expect(filterOutline(entries, '')).toHaveLength(entries.length)
  })

  it('writes a block as markdown with a fence, and a diff as a diff fence', () => {
    expect(blockMarkdown(blocks[1], 'a\nb')).toBe('```\na\nb\n```')
    expect(blockMarkdown(blocks[3], '+x')).toBe('```diff\n+x\n```')
    expect(blockMarkdown(blocks[0], 'hello')).toBe('> hello')
  })

  it('builds a failure message with the file and line', () => {
    const message = failureMessage(blocks[1], 'AssertionError\n tests/unit/miniWindow.test.ts:212:34')
    expect(message).toContain('Location: tests/unit/miniWindow.test.ts:212')
    expect(message.startsWith('This failed:')).toBe(true)
  })
})
