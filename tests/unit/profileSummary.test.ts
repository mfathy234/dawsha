import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { summarizeProfile, type CpuProfile } from '../../src/shared/profileSummary'
import { slowPageLine, writeSlowProfile } from '../../src/main/slowLogFile'

const node = (id: number, functionName: string, children: number[] = []) => ({ id, callFrame: { functionName, url: 'file:///app/assets/index-abc.js', lineNumber: id }, children })

const profile: CpuProfile = {
  nodes: [node(1, '(root)', [2]), node(2, 'outer', [3]), node(3, 'scan', [4]), node(4, 'translateToString'), node(5, '(idle)')],
  startTime: 0,
  endTime: 100_000,
  samples: [5, 4, 4, 3, 2],
  timeDeltas: [10_000, 10_000, 10_000, 10_000, 10_000]
}

describe('profile summary', () => {
  it('ranks functions by their own time and by time on the stack, ignoring idle', () => {
    const summary = summarizeProfile(profile, 1000)
    expect(summary.self[0]).toEqual({ frame: 'translateToString index-abc.js:5', ms: 20 })
    expect(summary.self.some((row) => row.frame.startsWith('(idle)'))).toBe(false)
    expect(summary.inclusive[0]).toEqual({ frame: 'outer index-abc.js:3', ms: 40 })
    expect(summary.inclusive.find((row) => row.frame.startsWith('scan'))?.ms).toBe(30)
  })

  it('only looks at the end of the profile, where the slow task just ran', () => {
    const summary = summarizeProfile(profile, 15)
    expect(summary.self.map((row) => row.frame.split(' ')[0])).toEqual(['outer', 'scan'])
  })

  it('copes with an empty profile', () => {
    expect(summarizeProfile({ ...profile, samples: [], timeDeltas: [] }, 100)).toEqual({ self: [], inclusive: [] })
  })
})

describe('slow profile files', () => {
  it('keeps the newest five', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slowp-'))
    for (let i = 0; i < 7; i += 1) writeSlowProfile(dir, { i }, new Date(Date.UTC(2026, 10, 28, 10, 0, i)))
    const files = readdirSync(dir).sort()
    expect(files).toHaveLength(5)
    expect(files[0]).toContain('10-00-02')
  })

  it('names the steps, the top functions and the file in the log line', () => {
    const line = slowPageLine({ ms: 5200, view: 'grid', detail: '4 panes', phases: [{ name: 'terminal show', ms: 4000 }], profile: { self: [{ frame: 'scan x.js:1', ms: 3000 }], inclusive: [] } }, 'dawsha-slow-a.json')
    expect(line).toContain('slowest steps: terminal show 4000 ms')
    expect(line).toContain('ran: scan x.js:1 3000 ms')
    expect(line).toContain('profile: dawsha-slow-a.json')
  })
})
