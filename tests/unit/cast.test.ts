import { describe, expect, it } from 'vitest'
import { castDuration, castEventLine, castHeaderLine, parseCast, parseCastAsync, parseResize, resizeData, roundSeconds } from '../../src/shared/cast'

const header = { version: 2 as const, width: 120, height: 30, timestamp: 1_700_000_000, title: 'Demo' }

describe('cast writing', () => {
  it('writes an asciinema v2 header as one JSON line', () => {
    const line = castHeaderLine(header)
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual(header)
  })

  it('writes events as [seconds, kind, data] lines with millisecond precision', () => {
    expect(JSON.parse(castEventLine(1.23456, 'o', 'hi\r\n'))).toEqual([1.235, 'o', 'hi\r\n'])
    expect(JSON.parse(castEventLine(0, 'm', 'prompt'))).toEqual([0, 'm', 'prompt'])
    expect(roundSeconds(-3)).toBe(0)
  })

  it('writes resize data as COLSxROWS and reads it back', () => {
    expect(resizeData(100, 40)).toBe('100x40')
    expect(parseResize('100x40')).toEqual({ cols: 100, rows: 40 })
    expect(parseResize('1x1')).toBeNull()
    expect(parseResize('wide')).toBeNull()
  })
})

describe('cast parsing', () => {
  it('round-trips a written recording, including unicode and escapes', () => {
    const text =
      castHeaderLine(header) +
      castEventLine(0.1, 'o', '\u001b[32mok\u001b[0m ✓\r\n') +
      castEventLine(0.5, 'r', '90x20') +
      castEventLine(2, 'm', 'exit')
    const parsed = parseCast(text)
    expect(parsed?.header).toEqual(header)
    expect(parsed?.events).toEqual([
      { t: 0.1, kind: 'o', data: '\u001b[32mok\u001b[0m ✓\r\n' },
      { t: 0.5, kind: 'r', data: '90x20' },
      { t: 2, kind: 'm', data: 'exit' }
    ])
    expect(castDuration(parsed?.events ?? [])).toBe(2)
  })

  it('rejects a file without a valid version 2 header', () => {
    expect(parseCast('')).toBeNull()
    expect(parseCast('not json\n')).toBeNull()
    expect(parseCast('{"version":1,"width":80,"height":24}\n')).toBeNull()
    expect(parseCast('{"version":2,"width":0,"height":24}\n')).toBeNull()
  })

  it('skips a truncated last line and unknown or malformed events', () => {
    const text = [
      castHeaderLine(header).trim(),
      '[0.2,"o","a"]',
      '[0.3,"i","typed"]',
      '[0.4,"o",5]',
      '["x","o","b"]',
      '[0.5,"o","c"]',
      '[0.6,"o","trunc'
    ].join('\n')
    expect(parseCast(text)?.events.map((event) => event.data)).toEqual(['a', 'c'])
  })

  it('keeps event times from going backwards', () => {
    const text = castHeaderLine(header) + '[1,"o","a"]\n[0.5,"o","b"]\n'
    expect(parseCast(text)?.events.map((event) => event.t)).toEqual([1, 1])
  })

  it('clamps absurd sizes in the header and in resize events', () => {
    const parsed = parseCast('{"version":2,"width":99999,"height":99999}' + String.fromCharCode(10))
    expect(parsed?.header).toMatchObject({ width: 1000, height: 500 })
    expect(parseResize('9999x9999')).toEqual({ cols: 1000, rows: 500 })
  })

  it('parses asynchronously to the same result, yielding between batches', async () => {
    const lines = [castHeaderLine(header).trim()]
    for (let i = 0; i < 45_000; i += 1) lines.push(JSON.stringify([i / 1000, 'o', 'x']))
    const text = lines.join(String.fromCharCode(10))
    let yields = 0
    const parsed = await parseCastAsync(text, async () => {
      yields += 1
    })
    expect(yields).toBe(2)
    expect(parsed?.events).toHaveLength(45_000)
    expect(parsed).toEqual(parseCast(text))
    expect(await parseCastAsync('nope')).toBeNull()
  })

  it('handles a header-only recording', () => {
    expect(parseCast(castHeaderLine(header))?.events).toEqual([])
  })
})
