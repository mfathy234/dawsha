import { describe, expect, it } from 'vitest'
import { ptyArguments, quoteWindowsArg, windowsCommandLine } from '../../src/main/commandLine'

function parseCommandLine(line: string): string[] {
  const args: string[] = []
  let current = ''
  let started = false
  let inQuotes = false
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (char === '\\') {
      let count = 0
      while (line[index] === '\\') {
        count += 1
        index += 1
      }
      if (line[index] === '"') {
        current += '\\'.repeat(Math.floor(count / 2))
        if (count % 2 === 1) {
          current += '"'
          index += 1
        }
      } else {
        current += '\\'.repeat(count)
      }
      started = true
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      started = true
    } else if (/\s/.test(char) && !inQuotes) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
    index += 1
  }
  if (started) args.push(current)
  return args
}

describe('quoteWindowsArg', () => {
  it('leaves simple arguments alone', () => {
    expect(quoteWindowsArg('--resume')).toBe('--resume')
    expect(quoteWindowsArg('C:\\work\\acme-web')).toBe('C:\\work\\acme-web')
  })

  it('quotes empty values and values with spaces, tabs or newlines', () => {
    expect(quoteWindowsArg('')).toBe('""')
    expect(quoteWindowsArg('fix the test')).toBe('"fix the test"')
    expect(quoteWindowsArg('a\tb')).toBe('"a\tb"')
    expect(quoteWindowsArg('one\ntwo')).toBe('"one\ntwo"')
  })

  it('escapes quotes and the backslashes in front of them', () => {
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""')
    expect(quoteWindowsArg('C:\\my dir\\')).toBe('"C:\\my dir\\\\"')
    expect(quoteWindowsArg('a\\"b')).toBe('"a\\\\\\"b"')
  })
})

describe('windowsCommandLine', () => {
  const samples: string[][] = [
    ['plain', 'two words', ''],
    ['Why does the login test fail on CI but not locally?'],
    ['He said "wait" & then ran | cmd > out.txt'],
    ['100% sure %PATH% ^caret'],
    ['trailing backslash\\', 'C:\\my dir\\'],
    ['line one\nline two\r\nline three'],
    ['"quoted at both ends"', '"lopsided', 'x"'],
    ['--prompt-interactive=fix the "flaky" test\\\\'],
    ['\\\\server\\share name\\file', 'a\\\\"b']
  ]

  it('round-trips through the Windows argument parser', () => {
    for (const args of samples) expect(parseCommandLine(windowsCommandLine(args))).toEqual(args)
  })

  it('joins with single spaces', () => {
    expect(windowsCommandLine(['a', 'b c'])).toBe('a "b c"')
    expect(windowsCommandLine([])).toBe('')
  })
})

describe('ptyArguments', () => {
  it('keeps POSIX arguments as an argv array and quotes Windows command lines', () => {
    expect(ptyArguments(['one', 'two words'], 'darwin')).toEqual(['one', 'two words'])
    expect(ptyArguments(['one', 'two words'], 'win32')).toBe('one "two words"')
  })
})
