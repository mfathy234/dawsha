import { describe, expect, it } from 'vitest'
import { frontMatterDescription } from '../../src/shared/frontMatter'

describe('frontMatterDescription', () => {
  it('reads a plain one-line description', () => {
    expect(frontMatterDescription('name: a\ndescription: Does the thing\n')).toBe('Does the thing')
  })

  it('strips surrounding quotes', () => {
    expect(frontMatterDescription('description: "Quoted text"')).toBe('Quoted text')
  })

  it('joins a folded block scalar into one line', () => {
    expect(frontMatterDescription('name: a\ndescription: >\n  First line\n  second line\nother: x')).toBe('First line second line')
  })

  it('joins literal and chomped block scalars too', () => {
    expect(frontMatterDescription('description: |-\n  One\n  Two\n')).toBe('One Two')
    expect(frontMatterDescription('description: >-\r\n  Windows\r\n  lines\r\n')).toBe('Windows lines')
  })

  it('returns undefined when there is no description or the block is empty', () => {
    expect(frontMatterDescription('name: a')).toBeUndefined()
    expect(frontMatterDescription('description: >\nname: a')).toBeUndefined()
  })
})
