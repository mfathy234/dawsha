import { describe, expect, it } from 'vitest'
import { unsavedQuitCopy } from '../../src/shared/dirtyFiles'

describe('unsavedQuitCopy', () => {
  it('names a single file in the heading, body and button', () => {
    const copy = unsavedQuitCopy(['src/a.ts'])
    expect(copy.title).toContain('a.ts')
    expect(copy.body).toContain('src/a.ts')
    expect(copy.confirmLabel).toBe('Discard changes to a.ts')
  })

  it('lists several files and counts the rest', () => {
    const paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts']
    const copy = unsavedQuitCopy(paths)
    expect(copy.title).toContain('7 files')
    expect(copy.body).toContain('a.ts, b.ts, c.ts, d.ts, e.ts and 2 more')
  })
})
