import { describe, expect, it } from 'vitest'
import { friendlyUpdateError } from '../../src/shared/updates'

describe('friendlyUpdateError', () => {
  it.each([
    'net::ERR_CONNECTION_TIMED_OUT',
    'net::ERR_INTERNET_DISCONNECTED',
    'getaddrinfo ENOTFOUND github.com',
    'connect ETIMEDOUT 140.82.112.4:443',
    'read ECONNRESET',
    'Error: socket hang up'
  ])('says GitHub could not be reached for %s and keeps the code', (raw) => {
    const result = friendlyUpdateError(raw)
    expect(result.message).toBe("Couldn't reach GitHub. Check your connection and try again.")
    expect(result.detail).toBe(raw)
  })

  it('keeps other errors as they are, on one line', () => {
    expect(friendlyUpdateError('Cannot find latest.yml\nstack line')).toEqual({ message: 'Cannot find latest.yml', detail: null })
  })

  it('falls back when there is no error text', () => {
    expect(friendlyUpdateError(null)).toEqual({ message: 'The update could not be completed.', detail: null })
    expect(friendlyUpdateError('  ')).toEqual({ message: 'The update could not be completed.', detail: null })
  })
})
