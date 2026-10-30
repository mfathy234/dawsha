import { describe, expect, it } from 'vitest'
import { parseCommitShow } from '../../src/shared/commitDetails'

const header = (parents: string, subject = 'subject', body = '') => `a1b2c3\x1fAuthor\x1fa@example.test\x1f100\x1fCommitter\x1fc@example.test\x1f110\x1f${parents}\x1f${subject}\x1f${body}\x1e\n`

describe('parseCommitShow', () => {
  it('parses counts, rename paths, and binary numstat records', () => {
    const parsed = parseCommitShow(`${header('parent')}2\t1\tfile.ts\0-\t-\timage.png\0 4\t2\t\0old.ts\0new.ts\0`, 'M\0file.ts\0M\0image.png\0R100\0old.ts\0new.ts\0')
    expect(parsed.files).toEqual([
      { status: 'M', path: 'file.ts', added: 2, removed: 1 },
      { status: 'M', path: 'image.png', added: null, removed: null },
      { status: 'R', oldPath: 'old.ts', path: 'new.ts', added: 4, removed: 2 }
    ])
    expect(parsed.added).toBe(6)
    expect(parsed.removed).toBe(3)
  })

  it('handles merge parents and an empty body', () => {
    const parsed = parseCommitShow(`${header('parent1 parent2', 'merge')}`)
    expect(parsed.parents).toEqual(['parent1', 'parent2'])
    expect(parsed.body).toBe('')
    expect(parsed.files).toEqual([])
  })
})
