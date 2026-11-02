import { describe, expect, it } from 'vitest'
import { addAttachments, attachmentOf, messageWithAttachments, removeAttachment } from '../../src/shared/chatAttach'

describe('attachments', () => {
  it('names a file and knows pictures', () => {
    expect(attachmentOf('C:\\p\\shot.PNG')).toEqual({ path: 'C:\\p\\shot.PNG', name: 'shot.PNG', image: true })
    expect(attachmentOf('/p/notes.txt').image).toBe(false)
  })

  it('adds without repeats, skips empty paths, and stops at the drop limit', () => {
    const first = addAttachments([], ['/a.png', '/a.png', '', '/b.txt'])
    expect(first.map((item) => item.path)).toEqual(['/a.png', '/b.txt'])
    expect(addAttachments(first, ['/a.png']).length).toBe(2)
    const many = addAttachments([], Array.from({ length: 30 }, (_, i) => `/f${i}.txt`))
    expect(many).toHaveLength(20)
  })

  it('does not change the list it was given', () => {
    const list = addAttachments([], ['/a.png'])
    addAttachments(list, ['/b.png'])
    removeAttachment(list, '/a.png')
    expect(list).toHaveLength(1)
  })

  it('removes one by path', () => {
    expect(removeAttachment(addAttachments([], ['/a.png', '/b.png']), '/a.png').map((i) => i.path)).toEqual(['/b.png'])
  })
})

describe('messageWithAttachments', () => {
  const list = addAttachments([], ['C:\\My Pics\\a.png', 'C:\\b.png'])

  it('puts the paths first, quoted as a drop would', () => {
    expect(messageWithAttachments('claude', list, 'what is this')).toBe('"C:\\My Pics\\a.png" C:\\b.png what is this')
  })

  it('uses @ for Gemini', () => {
    expect(messageWithAttachments('gemini', list, 'hi')).toBe('@"C:\\My Pics\\a.png" @C:\\b.png hi')
  })

  it('is just the text with no attachments, and just the paths with no text', () => {
    expect(messageWithAttachments('claude', [], 'hello')).toBe('hello')
    expect(messageWithAttachments('claude', addAttachments([], ['/a.png']), '')).toBe('/a.png')
  })
})
