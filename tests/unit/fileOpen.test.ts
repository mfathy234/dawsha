import { describe, expect, it } from 'vitest'
import { fileOpenKind, isSafeToOpen } from '../../src/shared/filePaths'

describe('fileOpenKind', () => {
  it('routes images to the image handler regardless of case or Unicode name', () => {
    expect(fileOpenKind('C:\\Work\\photo.PNG')).toBe('image')
    expect(fileOpenKind('C:\\Work\\صورتي المفضلة.webp')).toBe('image')
  })

  it('routes HTML to a browser, including names with spaces', () => {
    expect(fileOpenKind('C:\\Work\\my report.html')).toBe('html')
    expect(fileOpenKind('C:\\Work\\index.HTM')).toBe('html')
  })

  it('uses the default app for other safe files and does not bless executables', () => {
    expect(fileOpenKind('C:\\Work\\README.md')).toBe('default')
    expect(isSafeToOpen('C:\\Work\\run.exe')).toBe(false)
  })
})
