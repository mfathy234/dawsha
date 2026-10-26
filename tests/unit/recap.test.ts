import { describe, expect, it } from 'vitest'
import { cleanRecap, recapFromScreen } from '../../src/shared/recap'

describe('recapFromScreen', () => {
  it('prefers the recap line Claude printed', () => {
    const screen = '● Edit(a.ts)\n● Done with the sidebar.\n※ recap: Sorting closed sessions; e2e next.\n> '
    expect(recapFromScreen(screen)).toBe('Sorting closed sessions; e2e next.')
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
