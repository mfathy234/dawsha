import { describe, expect, it } from 'vitest'
import { utilityChildPids } from '../../src/main/childProcesses'

describe('utilityChildPids', () => {
  it('lists only this app utility processes, never the renderer, GPU or main process', () => {
    const metrics = [
      { pid: 100, type: 'Browser' },
      { pid: 101, type: 'Tab' },
      { pid: 102, type: 'GPU' },
      { pid: 103, type: 'Utility' },
      { pid: 104, type: 'Utility' }
    ]
    expect(utilityChildPids(metrics, 100)).toEqual([103, 104])
  })

  it('never includes the current process even if it reports as utility', () => {
    expect(utilityChildPids([{ pid: 7, type: 'Utility' }], 7)).toEqual([])
  })

  it('returns nothing when there are no children', () => {
    expect(utilityChildPids([], 1)).toEqual([])
  })
})
