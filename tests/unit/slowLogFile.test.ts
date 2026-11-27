import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { slowLogGate, writeSlowLine } from '../../src/main/slowLogFile'

describe('slow log', () => {
  it('lets one line through per quiet window', () => {
    const allowed = slowLogGate(10_000)
    expect(allowed(1000)).toBe(true)
    expect(allowed(5000)).toBe(false)
    expect(allowed(11_000)).toBe(true)
  })

  it('appends dated lines and moves a big log aside', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slow-'))
    const path = join(dir, 'logs', 'dawsha-slow.log')
    writeSlowLine(path, 'main blocked 900 ms', new Date('2026-11-27T10:00:00Z'))
    expect(readFileSync(path, 'utf8')).toBe('2026-11-27T10:00:00.000Z main blocked 900 ms\n')
    writeFileSync(path, 'x'.repeat(300 * 1024))
    writeSlowLine(path, 'page task 700 ms')
    expect(existsSync(`${path}.1`)).toBe(true)
    expect(readFileSync(path, 'utf8')).toMatch(/page task 700 ms\n$/)
  })
})
