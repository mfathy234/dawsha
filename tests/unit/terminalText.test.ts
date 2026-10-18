import { describe, expect, it } from 'vitest'
import { applyTyped, displayWidth, extractReply, isShellPromptLine, unwrapLines } from '../../src/shared/terminalText'

const line = (text: string, isWrapped = false) => ({ text, isWrapped })

describe('unwrapLines', () => {
  it('joins wrapped rows into one logical line', () => {
    expect(unwrapLines([line('abc'), line('def', true), line('ghi')])).toEqual(['abcdef', 'ghi'])
  })

  it('keeps a wrapped first row as its own line', () => {
    expect(unwrapLines([line('abc', true)])).toEqual(['abc'])
  })
})

describe('extractReply', () => {
  it('drops the prompt line, trailing blanks and a trailing windows prompt', () => {
    const lines = [line('C:\\acme-web>echo hi'), line('hi'), line(''), line('C:\\acme-web>'), line(''), line('')]
    expect(extractReply(lines, 0)).toEqual({ text: 'hi', lineCount: 1 })
  })

  it('drops a trailing PowerShell prompt', () => {
    const lines = [line('PS C:\\billing-api> ls'), line('a.txt'), line('b.txt'), line('PS C:\\billing-api>')]
    expect(extractReply(lines, 0)).toEqual({ text: 'a.txt\nb.txt', lineCount: 2 })
  })

  it('keeps a last line that only looks like output', () => {
    const lines = [line('> run'), line('done > 3')]
    expect(extractReply(lines, 0).text).toBe('done > 3')
  })

  it('unwraps wrapped rows and counts logical lines', () => {
    const lines = [line('> go'), line('first half of a long', false), line(' line', true), line('second')]
    expect(extractReply(lines, 0)).toEqual({ text: 'first half of a long line\nsecond', lineCount: 2 })
  })

  it('starts after the given row', () => {
    const lines = [line('old'), line('> go'), line('new')]
    expect(extractReply(lines, 1).text).toBe('new')
  })

  it('takes everything when there is no prompt row', () => {
    expect(extractReply([line('a'), line('b'), line('')], -1)).toEqual({ text: 'a\nb', lineCount: 2 })
  })

  it('returns empty text when nothing followed the prompt', () => {
    expect(extractReply([line('> go'), line('')], 0)).toEqual({ text: '', lineCount: 0 })
  })
})

describe('isShellPromptLine', () => {
  it('recognises shell prompts only', () => {
    expect(isShellPromptLine('C:\\work>')).toBe(true)
    expect(isShellPromptLine('PS C:\\work> ')).toBe(true)
    expect(isShellPromptLine('dev@box:~$')).toBe(true)
    expect(isShellPromptLine('C:\\work>dir')).toBe(false)
    expect(isShellPromptLine('plain text')).toBe(false)
  })
})

describe('applyTyped', () => {
  it('collects text and honours backspace', () => {
    expect(applyTyped('', 'helx')).toBe('helx')
    expect(applyTyped('helx', '\x7f')).toBe('hel')
    expect(applyTyped('hel', 'lo\b\b')).toBe('hel')
  })

  it('ignores escape sequences and clears on enter', () => {
    expect(applyTyped('ab', '\x1b[D\x1b[200~cd\x1b[201~')).toBe('abcd')
    expect(applyTyped('abcd', '\r')).toBe('')
  })
})

describe('displayWidth', () => {
  it('counts wide characters as two cells', () => {
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('日本語')).toBe(6)
  })
})
