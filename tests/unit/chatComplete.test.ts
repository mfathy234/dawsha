import { describe, expect, it } from 'vitest'
import { completionToken, fileCompletionRows, parseCommandFile, rankCompletions, validCommandsRequest } from '../../src/shared/chatComplete'

describe('chat completion pure logic', () => {
  it('detects slash and mention tokens only at supported caret positions', () => {
    expect(completionToken('/hel xyz', 4)).toMatchObject({ kind: 'command', query: 'hel' })
    expect(completionToken('say @src/a', 10)).toMatchObject({ kind: 'file', query: 'src/a' })
    expect(completionToken('say @src/a', 8)).toMatchObject({ kind: 'file', query: 'src' })
    expect(completionToken('/help', 6)).toBeNull()
  })
  it('ranks fuzzy names and parses command descriptions', () => {
    expect(rankCompletions([{ name: 'clear', description: '' }, { name: 'compact', description: '' }], 'cl')[0].name).toBe('clear')
    expect(parseCommandFile('---\ndescription: Do the thing\n---\n# title')).toBe('Do the thing')
    expect(parseCommandFile('# title\n\nFirst prose')).toBe('First prose')
  })
  it('caps ranking at 50 and applies boosts without discarding match quality', () => {
    const items = Array.from({ length: 80 }, (_, index) => ({ name: `file${index}`, description: '', recent: index === 79 }))
    expect(rankCompletions(items, 'file', (item) => item.recent ? 20 : 0)).toHaveLength(50)
    expect(rankCompletions([{ name: 'prefixmatch', description: '', recent: false }, { name: 'match', description: '', recent: true }], 'match', (item) => item.recent ? 20 : 0)[0].name).toBe('match')
  })
  it('keeps folder names to one trailing slash', () => {
    expect(fileCompletionRows(['src/index.ts']).find((item) => item.kind === 'folder')?.name).toBe('src/')
  })
  it('validates agent and folder request shape', () => {
    expect(validCommandsRequest({ agent: 'claude', folder: '/tmp' })).toBe(true)
    expect(validCommandsRequest({ agent: 'claude', folder: 'relative' })).toBe(false)
    expect(validCommandsRequest({ agent: 'shell', folder: '/tmp' })).toBe(false)
  })
})
