import { describe, expect, it } from 'vitest'
import { formatMemory, sumProcessMemory } from '../../src/shared/paneMemory'

describe('pane memory', () => {
  it('sums process tree readings by tab without mutating input', () => {
    const readings = [{ tabId: 'a', bytes: 4 }, { tabId: 'a', bytes: 6 }, { tabId: 'b', bytes: 2 }]
    expect(sumProcessMemory(readings)).toEqual({ a: 10, b: 2 })
    expect(readings).toHaveLength(3)
  })
  it('formats bytes in quiet whole megabytes', () => {
    expect(formatMemory(412 * 1024 * 1024)).toBe('412 MB')
    expect(formatMemory(-1)).toBe('—')
  })
})
