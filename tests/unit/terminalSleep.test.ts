import { describe, expect, it } from 'vitest'
import { terminalShouldSleep } from '../../src/shared/terminalSleep'

describe('terminal sleep policy', () => {
  it('sleeps only after a continuously hidden interval', () => {
    expect(terminalShouldSleep({ visible: false, hiddenSince: 0 }, 600_000, 600_000, true)).toBe(true)
    expect(terminalShouldSleep({ visible: false, hiddenSince: 1 }, 600_000, 600_000, true)).toBe(false)
    expect(terminalShouldSleep({ visible: true, hiddenSince: 0 }, 900_000, 600_000, true)).toBe(false)
    expect(terminalShouldSleep({ visible: false, hiddenSince: 0 }, 900_000, 600_000, false)).toBe(false)
  })
})
