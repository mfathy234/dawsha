import { describe, expect, it } from 'vitest'
import { appendIgnoreEntry, checkIgnorePath, foldRows, folderFilesText, ignoreEntry, isHeavyFolder, shouldFoldFolder } from '../../src/shared/gitIgnore'

describe('checkIgnorePath', () => {
  it('accepts a relative folder and drops the trailing slash', () => {
    expect(checkIgnorePath('downloads/')).toEqual({ ok: true, path: 'downloads' })
    expect(checkIgnorePath('a/b c/')).toEqual({ ok: true, path: 'a/b c' })
  })
  it('rejects anything that could leave the repository or break the line', () => {
    for (const bad of ['', '  ', '/x', '../x', 'a/../b', 'a//b', './a', 'C:\\x', 'C:/x', 'a\\b', 'a\nb', 'a\rb', 'a\u0000b', '.git', '.git/hooks', 5, null]) {
      expect(checkIgnorePath(bad).ok).toBe(false)
    }
  })
})

describe('ignoreEntry', () => {
  it('anchors to the root and matches folders only', () => {
    expect(ignoreEntry('downloads')).toBe('/downloads/')
    expect(ignoreEntry('a/b')).toBe('/a/b/')
  })
  it('escapes characters git would read as patterns', () => {
    expect(ignoreEntry('#tmp')).toBe('/\\#tmp/')
    expect(ignoreEntry('!keep')).toBe('/\\!keep/')
    expect(ignoreEntry('a*b[1]')).toBe('/a\\*b\\[1\\]/')
    expect(ignoreEntry('trail  ')).toBe('/trail\\ \\ /')
  })
})

describe('appendIgnoreEntry', () => {
  it('creates, appends and adds the missing newline', () => {
    expect(appendIgnoreEntry('', '/d/')).toBe('/d/\n')
    expect(appendIgnoreEntry('a\n', '/d/')).toBe('a\n/d/\n')
    expect(appendIgnoreEntry('a', '/d/')).toBe('a\n/d/\n')
  })
  it('keeps CRLF files CRLF', () => {
    expect(appendIgnoreEntry('a\r\nb\r\n', '/d/')).toBe('a\r\nb\r\n/d/\r\n')
    expect(appendIgnoreEntry('a\r\nb', '/d/')).toBe('a\r\nb\r\n/d/\r\n')
  })
  it('does nothing when an equivalent line exists', () => {
    for (const line of ['/d/', 'd/', '/d', 'd', '/d/\r']) expect(appendIgnoreEntry(`x\n${line}\n`, '/d/')).toBeNull()
    expect(appendIgnoreEntry('dd/\n', '/d/')).not.toBeNull()
  })
})

describe('folder rows', () => {
  const folder = (files: number, bytes: number, capped = false) => ({ path: 'downloads/', files, bytes, capped })
  const mb = 1024 * 1024
  it('folds big or numerous folders and warns from 100 MB', () => {
    expect(shouldFoldFolder(folder(3, 1000))).toBe(false)
    expect(shouldFoldFolder(folder(30, 1000))).toBe(true)
    expect(shouldFoldFolder(folder(2, 6 * mb))).toBe(true)
    expect(shouldFoldFolder(folder(2, 10, true))).toBe(true)
    expect(isHeavyFolder(folder(1, 99 * mb))).toBe(false)
    expect(isHeavyFolder(folder(1, 100 * mb))).toBe(true)
  })
  it('words the count', () => {
    expect(folderFilesText(1, false)).toBe('1 new file')
    expect(folderFilesText(6, false)).toBe('6 new files')
    expect(folderFilesText(5000, true)).toBe('5000+ new files')
  })
})

describe('foldRows', () => {
  const folder = { path: 'downloads/', files: 3, bytes: 300 * 1024 * 1024, capped: false }
  it('folds new files of a big untracked folder and keeps everything else', () => {
    const rows = [
      { path: 'a.ts', letter: 'M' },
      { path: 'downloads/x.exe', letter: 'U' },
      { path: 'src/n.ts', letter: 'U' },
      { path: 'downloads/y.exe', letter: 'U' },
      { path: 'downloads/staged.txt', letter: 'A' }
    ]
    const folded = foldRows(rows, [folder])
    expect(folded.map((item) => (item.kind === 'file' ? item.row.path : item.folder.path))).toEqual(['a.ts', 'downloads/', 'src/n.ts', 'downloads/staged.txt'])
    expect(folded[1]).toMatchObject({ kind: 'folder', rows: [rows[1], rows[3]] })
  })
  it('leaves small folders alone', () => {
    const rows = [{ path: 'small/a.ts', letter: 'U' }]
    expect(foldRows(rows, [{ path: 'small/', files: 1, bytes: 10, capped: false }])).toEqual([{ kind: 'file', row: rows[0] }])
  })
})
