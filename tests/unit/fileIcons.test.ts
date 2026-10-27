import { describe, expect, it } from 'vitest'
import { fileIconFor } from '../../src/shared/fileIcons'

describe('fileIconFor', () => {
  it('picks an icon by extension, ignoring case and folders in the path', () => {
    expect(fileIconFor('src/context/theme.tsx')).toEqual({ kind: 'tsx', glyph: 'TS' })
    expect(fileIconFor('SRC\\A.TS')).toEqual({ kind: 'ts', glyph: 'TS' })
    expect(fileIconFor('README.md')).toEqual({ kind: 'md', glyph: 'M↓' })
    expect(fileIconFor('index.css').kind).toBe('css')
    expect(fileIconFor('App.csproj').kind).toBe('xml')
    expect(fileIconFor('logo.PNG').kind).toBe('image')
  })

  it('knows files by their whole name before their extension', () => {
    expect(fileIconFor('package.json').kind).toBe('json')
    expect(fileIconFor('package-lock.json').kind).toBe('lock')
    expect(fileIconFor('.gitignore').kind).toBe('git')
    expect(fileIconFor('apps/web/.env.local').kind).toBe('env')
    expect(fileIconFor('Dockerfile').kind).toBe('config')
  })

  it('falls back to a plain file icon, also for names with no extension', () => {
    expect(fileIconFor('weird.zzz')).toEqual({ kind: 'file', glyph: '≡' })
    expect(fileIconFor('Procfile').kind).toBe('file')
    expect(fileIconFor('').kind).toBe('file')
  })
})
