import { describe, expect, it } from 'vitest'
import type { CastEvent } from '../../src/shared/cast'
import { AnsiStripper, buildSearchIndex, derivePermissionMarkers, searchRecording, stripAnsi } from '../../src/shared/replaySearch'

const out = (t: number, data: string): CastEvent => ({ t, kind: 'o', data })
const ESC = String.fromCharCode(27)

describe('ANSI stripping', () => {
  it('removes colours, cursor control and OSC titles', () => {
    expect(stripAnsi(`${ESC}[1;32mPASS${ESC}[0m src/a.ts`)).toBe('PASS src/a.ts')
    expect(stripAnsi(`${ESC}]0;window title\u0007hello`)).toBe('hello')
    expect(stripAnsi(`${ESC}]8;;http://x${ESC}\\link${ESC}]8;;${ESC}\\`)).toBe('link')
    expect(stripAnsi(`${ESC}(Bplain${ESC}[?25l`)).toBe('plain')
  })

  it('keeps words apart when the cursor jumps to another row or column', () => {
    expect(stripAnsi(`one${ESC}[5;1Htwo`)).toBe('one\ntwo')
    expect(stripAnsi(`a${ESC}[1Cb`)).toBe('a b')
  })

  it('turns carriage returns into line breaks and drops other control characters', () => {
    expect(stripAnsi('a\r\nb\rc\u0007\u0008d')).toBe('a\nb\ncd')
  })

  it('handles an escape sequence split across two chunks', () => {
    const stripper = new AnsiStripper()
    expect(stripper.feed(`red ${ESC}[3`) + stripper.feed(`1mtext${ESC}[0m`)).toBe('red text')
  })
})

describe('search with timestamps', () => {
  const events: CastEvent[] = [
    out(0.2, 'Running tests\r\n'),
    out(1.5, `${ESC}[32m PASS${ESC}[0m src/a.test.ts\r\n`),
    { t: 2, kind: 'm', data: 'prompt' },
    out(3, `${ESC}[31m FAIL${ESC}[0m src/b.test.ts\r\n`),
    out(7, 'all done, pass count 12\r\n')
  ]
  const index = buildSearchIndex(events)

  it('indexes only output events, mapped back to their event index', () => {
    expect(index.eventIndexes).toEqual([0, 1, 3, 4])
    expect(index.text).toContain('PASS src/a.test.ts')
  })

  it('finds text across colour codes and reports the time of the event that printed it', () => {
    const matches = searchRecording(index, events, 'PASS src/a')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ eventIndex: 1, t: 1.5, line: 'PASS src/a.test.ts' })
  })

  it('is case-insensitive and lists every distinct line in time order', () => {
    const matches = searchRecording(index, events, 'pass')
    expect(matches.map((match) => [match.t, match.line])).toEqual([
      [1.5, 'PASS src/a.test.ts'],
      [7, 'all done, pass count 12']
    ])
  })

  it('treats the query literally, not as a regular expression', () => {
    expect(searchRecording(index, events, '.*')).toEqual([])
    expect(searchRecording(index, events, 'a.test')).toHaveLength(1)
  })

  it('matches text that a chunk boundary split in two, reporting the chunk that completes it', () => {
    const split = [out(1, 'build fin'), out(2, 'ished ok\r\n')]
    const matches = searchRecording(buildSearchIndex(split), split, 'finished')
    expect(matches).toHaveLength(1)
    expect(matches[0].eventIndex).toBe(1)
    expect(matches[0].t).toBe(2)
  })

  it('collapses repeated identical lines and honours the limit', () => {
    const repeated = Array.from({ length: 5 }, (_, i) => out(i, 'status: idle\r\n'))
    expect(searchRecording(buildSearchIndex(repeated), repeated, 'status')).toHaveLength(1)
    const distinct = Array.from({ length: 5 }, (_, i) => out(i, `line ${i} hit\r\n`))
    expect(searchRecording(buildSearchIndex(distinct), distinct, 'hit', 3)).toHaveLength(3)
  })

  it('returns nothing for an empty query or an empty recording', () => {
    expect(searchRecording(index, events, '  ')).toEqual([])
    expect(searchRecording(buildSearchIndex([]), [], 'x')).toEqual([])
  })
})

describe('derived permission markers', () => {
  const prompt = [
    ' Bash command',
    '   npm test',
    ' Do you want to proceed?',
    ' 1. Yes',
    ' 2. Yes, and do not ask again',
    ' 3. No, and tell Claude what to do differently (esc)'
  ].join('\r\n')

  it('marks the moment a permission prompt appears, once per prompt', () => {
    const events = [out(1, 'working\r\n'), out(5, `${prompt}\r\n`), out(5.1, '\r\n'), out(40, `${prompt}\r\n`)]
    const markers = derivePermissionMarkers(buildSearchIndex(events), events)
    expect(markers.map((marker) => [marker.kind, marker.t])).toEqual([['permission', 5], ['permission', 40]])
  })

  it('finds nothing in plain output', () => {
    const events = [out(1, 'hello\r\n'), out(2, 'Yes it works\r\n')]
    expect(derivePermissionMarkers(buildSearchIndex(events), events)).toEqual([])
  })
})
