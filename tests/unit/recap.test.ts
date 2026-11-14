import { describe, expect, it } from 'vitest'
import { cleanRecap, outputLines, recapFromScreen } from '../../src/shared/recap'

describe('recapFromScreen', () => {
  it('prefers the recap line Claude printed', () => {
    const screen = '● Edit(a.ts)\n● Done with the sidebar.\n※ recap: Sorting closed sessions; e2e next.\n> '
    expect(recapFromScreen(screen)).toBe('Sorting closed sessions; e2e next.')
  })

  it('ignores the status line under the input box and Remote Control notices', () => {
    const screen = [
      '● The trial ran the all-modules package, then moved to the monthly HR package.',
      '● Remote Control disconnected, another connection took over this session (code 4090)',
      '────────────────',
      '❯ ',
      '────────────────',
      '● main  ✻ claude Opus 5.5',
      '  ▸▸ bypass permissions on (shift+tab to cycle)'
    ].join('\n')
    expect(recapFromScreen(screen)).toBe('The trial ran the all-modules package, then moved to the monthly HR package.')
  })

  it('says nothing when the only bullets are Remote Control notices and the status line', () => {
    expect(recapFromScreen('● Remote Control not started\n❯ \n● main  ✻ claude Opus 5.5')).toBe('')
  })

  it('takes the latest recap', () => {
    expect(recapFromScreen('recap: old\nrecap: new')).toBe('new')
  })

  it('falls back to the last reply and skips tool calls', () => {
    const screen = '● I fixed the import.\n● Bash(npm test)\n  ⎿ ok'
    expect(recapFromScreen(screen)).toBe('I fixed the import.')
  })

  it('gives nothing when there is neither', () => {
    expect(recapFromScreen('$ ls\nfile')).toBe('')
    expect(recapFromScreen('')).toBe('')
  })

  it('strips markup and control characters and caps the length', () => {
    expect(cleanRecap('**Fixed** `x` [docs](http://a.b)\u001b[0m')).toBe('Fixed x docs [0m')
    expect(cleanRecap('a'.repeat(500))).toHaveLength(240)
  })
})

describe('outputLines', () => {
  it('keeps the agent output above its input box and drops border lines and the status line', () => {
    const screen = [
      '● Ran the audit spec, 12 screenshots saved.',
      '  Waiting for 1 background agent',
      '────────────────────',
      '❯ ',
      '────────────────────',
      '● main  ✻ claude  Opus 5.5',
      '▸▸ bypass permissions on (shift+tab to cycle)'
    ].join('\n')
    expect(outputLines(screen, 3)).toEqual(['● Ran the audit spec, 12 screenshots saved.', '  Waiting for 1 background agent'])
  })

  it('drops border rows that the terminal joined into one long line, and finds the input box inside them', () => {
    const rule = '─'.repeat(60)
    const screen = [
      '● Committed the layout, rail and CI changes.',
      rule + rule + rule + '→',
      rule + rule,
      rule + ' ❯ ',
      rule,
      '● main  ✻ claude  Opus 5.5'
    ].join('\n')
    expect(outputLines(screen, 3)).toEqual(['● Committed the layout, rail and CI changes.'])
  })

  it('keeps the words of a line that a border runs through', () => {
    expect(outputLines('──── Tests  41 passed ────\n', 3)).toEqual(['Tests  41 passed'])
  })

  it('uses the whole screen when there is no input box', () => {
    expect(outputLines('$ npm test\n\nPASS src/a.test.ts\n', 3)).toEqual(['$ npm test', 'PASS src/a.test.ts'])
  })
})
