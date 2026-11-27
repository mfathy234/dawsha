import { describe, expect, it } from 'vitest'
import { BlockScanner, type BlockSource } from '../../src/shared/terminalBlockScan'
import { parseBlocks, type BlockLine, type BlockOptions } from '../../src/shared/terminalBlocks'
import { CLAUDE_SESSION, CODEX_SESSION, toLines } from '../support/blockFixtures'

function sourceOf(texts: readonly string[], stable: number): BlockSource {
  const lines: BlockLine[] = texts.map((text, row) => ({ row, rows: 1, text }))
  return { length: texts.length, stable, lines: (from, to) => lines.slice(Math.max(0, from), to + 1), isWrapped: () => false }
}

const SAMPLES = [
  '> run the unit tests',
  '● Bash(npm test)',
  '  ⎿ 12 passed in 3.2s',
  '● Update(src/a.ts)',
  '  @@ -1,2 +1,3 @@',
  '  + added line',
  '● It now works.',
  'plain text between blocks',
  '● Bash(npm run build)',
  '  ✗ Error: build failed',
  '',
  'Do you want to proceed?'
]

function stream(count: number): string[] {
  const out: string[] = []
  let seed = 7
  for (let index = 0; index < count; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out.push(SAMPLES[seed % SAMPLES.length])
  }
  return out
}

function expectSame(scanner: BlockScanner, texts: readonly string[], stable: number, options: BlockOptions): void {
  const source = sourceOf(texts, stable)
  expect(scanner.scan(source, options)).toEqual(parseBlocks(source.lines(0, texts.length - 1), options))
}

describe('BlockScanner', () => {
  it('gives the same blocks as a full parse while output streams in', () => {
    const texts = stream(400)
    const scanner = new BlockScanner()
    for (let length = 1; length <= texts.length; length += 7) {
      const part = texts.slice(0, length)
      expectSame(scanner, part, Math.max(0, length - 30), { agent: 'claude', running: length % 2 === 0 })
    }
  })

  it('gives the same blocks with a live area, prompt rows and shell commands', () => {
    const texts = stream(300)
    const scanner = new BlockScanner()
    for (let length = 20; length <= texts.length; length += 5) {
      const part = texts.slice(0, length)
      const options: BlockOptions = { agent: 'shell', liveFromRow: length - 3, promptRows: new Set([3, 40, 90]), commands: [{ row: 10, title: 'ls', exitCode: 0 }, { row: 120, title: 'make', exitCode: 2 }] }
      expectSame(scanner, part, Math.max(0, length - 25), options)
    }
  })

  it('matches on the Claude and Codex fixtures, one row at a time', () => {
    for (const session of [CLAUDE_SESSION, CODEX_SESSION]) {
      const texts = toLines(session).map((line) => line.text)
      const scanner = new BlockScanner()
      for (let length = 1; length <= texts.length; length += 1) expectSame(scanner, texts.slice(0, length), Math.max(0, length - 10), { agent: 'claude' })
    }
  })

  it('scans everything again when the scrollback was trimmed, cleared or the options changed', () => {
    const texts = stream(200)
    const scanner = new BlockScanner()
    expectSame(scanner, texts, 150, { agent: 'claude' })
    expectSame(scanner, texts.slice(25), 125, { agent: 'claude' })
    expectSame(scanner, texts.slice(25, 90), 40, { agent: 'claude' })
    expectSame(scanner, texts.slice(25, 160), 100, { agent: 'codex' })
    expectSame(scanner, texts.slice(25, 160), 100, { agent: 'codex', liveFromRow: 20 })
  })

  it('reads fewer rows than a full scan once the scrollback is settled', () => {
    const texts = stream(500)
    const scanner = new BlockScanner()
    const first = sourceOf(texts.slice(0, 480), 460)
    scanner.scan(first, { agent: 'claude' })
    let asked = 0
    const next = sourceOf(texts, 480)
    const counting: BlockSource = { ...next, lines: (from, to) => { asked += to - from + 1; return next.lines(from, to) } }
    scanner.scan(counting, { agent: 'claude' })
    expect(asked).toBeLessThan(200)
  })
})
