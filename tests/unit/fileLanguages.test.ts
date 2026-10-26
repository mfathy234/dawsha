import { describe, expect, it } from 'vitest'
import { languageKey } from '../../src/renderer/files/languages'

describe('languageKey', () => {
  it('maps common extensions', () => {
    expect(languageKey('src/a.ts')).toBe('typescript')
    expect(languageKey('src/a.tsx')).toBe('tsx')
    expect(languageKey('a.mjs')).toBe('javascript')
    expect(languageKey('docs/README.MD')).toBe('markdown')
    expect(languageKey('C:\\p\\Program.cs')).toBe('csharp')
    expect(languageKey('x/run.ps1')).toBe('powershell')
    expect(languageKey('ci.yml')).toBe('yaml')
  })

  it('maps well-known file names', () => {
    expect(languageKey('Dockerfile')).toBe('shell')
  })

  it('falls back to plain for unknown or missing extensions', () => {
    expect(languageKey('a.unknownext')).toBe('plain')
    expect(languageKey('LICENSE')).toBe('plain')
    expect(languageKey('dir.d/file')).toBe('plain')
  })
})
