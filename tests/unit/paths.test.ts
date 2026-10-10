import { afterEach, describe, expect, it } from 'vitest'
import { legacyUserDataDir } from '../../src/main/paths'

const previous = process.env.DAWSHA_LEGACY_USER_DATA

afterEach(() => {
  if (previous === undefined) delete process.env.DAWSHA_LEGACY_USER_DATA
  else process.env.DAWSHA_LEGACY_USER_DATA = previous
})

describe('legacyUserDataDir', () => {
  it('does not import another app’s settings automatically', () => {
    delete process.env.DAWSHA_LEGACY_USER_DATA
    expect(legacyUserDataDir()).toBeNull()
  })

  it('uses only the explicitly requested import folder', () => {
    process.env.DAWSHA_LEGACY_USER_DATA = 'C:\\old-app'
    expect(legacyUserDataDir()).toBe('C:\\old-app')
  })
})
