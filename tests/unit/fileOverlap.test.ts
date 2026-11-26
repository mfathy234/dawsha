import { describe, expect, it } from 'vitest'
import { baseName, findOverlaps, overlapLine, overlapTell, warningKey } from '../../src/shared/fileOverlap'

const NOW = 10_000_000
const MIN = 60_000

describe('file overlap', () => {
  it('warns both sessions that edited the same file in the same checkout', () => {
    const warnings = findOverlaps([
      { paneId: 'a', checkout: 'C:\\Work\\app', file: 'src/x.ts', at: NOW - 6 * MIN },
      { paneId: 'b', checkout: 'c:/work/app/', file: 'src/x.ts', at: NOW - 2 * MIN }
    ], NOW)
    expect(warnings).toEqual([
      { paneId: 'a', otherPaneId: 'b', file: 'src/x.ts', at: NOW - 2 * MIN },
      { paneId: 'b', otherPaneId: 'a', file: 'src/x.ts', at: NOW - 6 * MIN }
    ])
  })

  it('never warns across separate worktrees, other files or old edits', () => {
    expect(findOverlaps([{ paneId: 'a', checkout: '/r', file: 'x', at: NOW }, { paneId: 'b', checkout: '/r-wt', file: 'x', at: NOW }], NOW)).toEqual([])
    expect(findOverlaps([{ paneId: 'a', checkout: '/r', file: 'x', at: NOW }, { paneId: 'b', checkout: '/r', file: 'y', at: NOW }], NOW)).toEqual([])
    expect(findOverlaps([{ paneId: 'a', checkout: '/r', file: 'x', at: NOW }, { paneId: 'b', checkout: '/r', file: 'x', at: NOW - 180 * MIN }], NOW)).toEqual([])
  })

  it('does not warn a session about its own edits', () => {
    expect(findOverlaps([{ paneId: 'a', checkout: '/r', file: 'x', at: NOW }, { paneId: 'a', checkout: '/r', file: 'x', at: NOW - 1 }], NOW)).toEqual([])
  })

  it('words the line and the message to the agent', () => {
    expect(baseName('src/a/sessionTabs.ts')).toBe('sessionTabs.ts')
    expect(overlapLine('src/a/sessionTabs.ts', NOW - 6 * MIN, 'New feature ideas', NOW)).toBe('sessionTabs.ts changed 6 minutes ago by New feature ideas, in the same checkout')
    expect(overlapLine('x.ts', NOW, 'Other', NOW)).toContain('just now')
    expect(overlapTell('src/a/sessionTabs.ts')).toBe('Another session just changed sessionTabs.ts. Re-read it before you edit it again.')
    expect(warningKey({ paneId: 'a', file: 'x' })).toBe('a\nx')
  })
})
