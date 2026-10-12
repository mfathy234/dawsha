import { describe, expect, it } from 'vitest'
import { collectProcessActivity, parsePosixProcesses, selectProcessActivity, type ProcessRecord } from '../../src/main/processActivity'

const records: ProcessRecord[] = [
  { pid: 100, parentPid: 1, name: 'cmd.exe', startedAt: 1000 },
  { pid: 101, parentPid: 100, name: 'node.exe', startedAt: 1100 },
  { pid: 102, parentPid: 101, name: 'helper.exe', startedAt: 1200 },
  { pid: 300, parentPid: 1, name: 'unrelated.exe', startedAt: 1000 }
]

describe('native process activity', () => {
  it('parses macOS ps rows and converts elapsed time to process start times', () => {
    const parsed = parsePosixProcesses('  100     1  00:12.50 /bin/zsh\n  101   100  1-02:03:04 node')
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ pid: 100, parentPid: 1, name: '/bin/zsh' })
    expect(parsed[0].startedAt).toBeGreaterThan(0)
    expect(parsed[1]).toMatchObject({ pid: 101, parentPid: 100, name: 'node' })
    expect(parsed[1].startedAt!).toBeLessThan(parsed[0].startedAt!)
  })

  it('returns only a PTY root and descendants, tagged to its tab', () => {
    expect(selectProcessActivity([{ tabId: 'tab-a', pid: 100, startedAt: 1000 }], records).map((p) => [p.tabId, p.pid, p.name])).toEqual([
      ['tab-a', 100, 'cmd.exe'], ['tab-a', 101, 'node.exe'], ['tab-a', 102, 'helper.exe']
    ])
  })

  it('rejects missing or reused root PIDs and children older than their parent', () => {
    expect(selectProcessActivity([{ tabId: 'missing', pid: 999, startedAt: 1000 }], records)).toEqual([])
    expect(selectProcessActivity([{ tabId: 'reused', pid: 100, startedAt: 100_000 }], records)).toEqual([])
    const staleChild = { pid: 103, parentPid: 100, name: 'old.exe', startedAt: 500 }
    expect(selectProcessActivity([{ tabId: 'tab-a', pid: 100, startedAt: 1000 }], [...records, staleChild]).some((p) => p.pid === 103)).toBe(false)
  })

  it('treats denied process enumeration as unavailable without throwing', async () => {
    const result = await collectProcessActivity([{ tabId: 'tab-a', pid: 100, startedAt: 1000 }], async () => { throw new Error('Access denied') })
    expect(result).toEqual([])
  })
})
