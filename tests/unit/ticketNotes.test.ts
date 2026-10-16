import { describe, expect, it } from 'vitest'
import { isTicketLink, sanitizeTicketNotes, setTicketNote } from '../../src/shared/ticketNotes'

describe('ticket notes', () => {
  it('saves a name and a web link, adding https:// when it is left out', () => {
    const notes = setTicketNote({}, 'branch:p1:fix/18550', { name: ' Login crash ', link: 'dev.azure.com/MicrotecEgypt/_workitems/edit/18550' })
    expect(notes).toEqual({ 'branch:p1:fix/18550': { name: 'Login crash', link: 'https://dev.azure.com/MicrotecEgypt/_workitems/edit/18550' } })
  })

  it('removes a note when both fields are cleared, without changing the original', () => {
    const before = { a: { name: 'x', link: '' } }
    expect(setTicketNote(before, 'a', { name: '', link: ' ' })).toEqual({})
    expect(before).toEqual({ a: { name: 'x', link: '' } })
  })

  it('refuses links that are not web addresses', () => {
    expect(() => setTicketNote({}, 'a', { name: '', link: 'javascript:alert(1)' })).toThrow(/web address/)
    expect(() => setTicketNote({}, 'a', { name: '', link: 'file:///C:/secret' })).toThrow(/web address/)
    expect(isTicketLink('https://example.com/a')).toBe(true)
  })

  it('keeps only valid notes when reading settings from disk', () => {
    expect(sanitizeTicketNotes({ ok: { name: 'Fix', link: 'https://x.dev/1' }, bad: { name: 'Keep name', link: 'javascript:x' }, empty: { name: '' }, junk: 3 })).toEqual({
      ok: { name: 'Fix', link: 'https://x.dev/1' }, bad: { name: 'Keep name', link: '' }
    })
    expect(sanitizeTicketNotes(null)).toEqual({})
  })
})
