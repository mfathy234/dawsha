import { describe, expect, it } from 'vitest'
import { DROP_FILE_LIMIT, dropPasteText, imagePasteText, pasteText, pathsFromUriList, shellKindOf } from '../../src/shared/clipboard'

describe('pasteText', () => {
  it('pastes text as is and nothing for an empty clipboard', () => {
    expect(pasteText({ kind: 'text', text: 'hello' }, 'claude')).toBe('hello')
    expect(pasteText({ kind: 'empty' }, 'claude')).toBe('')
  })

  it('pastes an image as its file path, as an @ reference for Gemini, quoted when it has spaces', () => {
    expect(imagePasteText('claude', 'C:\Temp\dawsha-paste\paste-1.png')).toBe('C:\Temp\dawsha-paste\paste-1.png ')
    expect(imagePasteText('codex', 'C:\Temp\p.png')).toBe('C:\Temp\p.png ')
    expect(imagePasteText('gemini', 'C:\Temp\p.png')).toBe('@C:\Temp\p.png ')
    expect(imagePasteText('shell', 'C:\\My Temp\\p.png')).toBe("'C:\\My Temp\\p.png' ")
    expect(imagePasteText('shell', 'C:\\My Temp\\p.png', 'cmd')).toBe('"C:\\My Temp\\p.png" ')
    expect(imagePasteText('shell', '/Users/me/My Temp/p.png', 'posix')).toBe("'/Users/me/My Temp/p.png' ")
    expect(pasteText({ kind: 'image', path: 'C:\\My Temp\\p.png' }, 'gemini')).toBe('@"C:\\My Temp\\p.png" ')
  })

  it('quotes shell characters in names so a shell tab never runs part of a file name', () => {
    expect(imagePasteText('shell', 'C:\\dl\\report;curl x|sh.pdf')).toBe("'C:\\dl\\report;curl x|sh.pdf' ")
    expect(imagePasteText('shell', "C:\\dl\\it's $(evil).txt")).toBe("'C:\\dl\\it''s $(evil).txt' ")
    expect(imagePasteText('shell', "/Users/me/it's $(evil).txt", 'posix')).toBe("'/Users/me/it'\\''s $(evil).txt' ")
    expect(imagePasteText('shell', 'C:\\dl\\a&b.txt', 'cmd')).toBe('"C:\\dl\\a&b.txt" ')
    expect(imagePasteText('shell', 'C:\\work\\acme-web\\src\\app.ts')).toBe('C:\\work\\acme-web\\src\\app.ts ')
    expect(shellKindOf('C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
    expect(shellKindOf('pwsh.exe')).toBe('powershell')
    expect(shellKindOf('/bin/zsh')).toBe('posix')
  })
})

describe('dropPasteText', () => {
  it('types dropped paths space separated, quoting those with spaces', () => {
    expect(dropPasteText('claude', ['C:\\a\\one.txt', 'C:\\my docs\\two.txt'])).toBe('C:\\a\\one.txt "C:\\my docs\\two.txt" ')
  })

  it('uses @ references for Gemini', () => {
    expect(dropPasteText('gemini', ['C:\\a\\one.txt', 'C:\\my docs'])).toBe('@C:\\a\\one.txt @"C:\\my docs" ')
  })

  it('skips empty paths and caps the drop at 20 files', () => {
    expect(dropPasteText('shell', ['', 'x'])).toBe('x ')
    const many = Array.from({ length: 25 }, (_, i) => `f${i}`)
    expect(dropPasteText('shell', many).trim().split(' ')).toHaveLength(DROP_FILE_LIMIT)
    expect(dropPasteText('shell', [])).toBe('')
  })
})

describe('pathsFromUriList', () => {
  it('reads file URIs and ignores comments and other schemes', () => {
    const list = '# comment\r\nfile:///C:/acme%20web/a.txt\r\nhttps://example.com\r\nfile:///home/me/b.txt\n'
    expect(pathsFromUriList(list)).toEqual(['C:\\acme web\\a.txt', '/home/me/b.txt'])
  })
})
