import { afterEach, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { legacyUserDataDir, opsDirs } from '../../src/main/paths'

const previous = process.env.DAWSHA_LEGACY_USER_DATA
const previousOpsDir = process.env.DAWSHA_OPS_DIR

afterEach(() => {
  if (previous === undefined) delete process.env.DAWSHA_LEGACY_USER_DATA
  else process.env.DAWSHA_LEGACY_USER_DATA = previous
  if (previousOpsDir === undefined) delete process.env.DAWSHA_OPS_DIR
  else process.env.DAWSHA_OPS_DIR = previousOpsDir
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

describe('opsDirs', () => {
  it('uses the macOS app data folder and keeps reading the legacy folder', () => {
    delete process.env.DAWSHA_OPS_DIR
    expect(opsDirs('darwin')).toEqual([
      join(homedir(), 'Library', 'Application Support', 'Dawsha', 'ops'),
      join(homedir(), 'Library', 'Application Support', 'claude-grid', 'ops')
    ])
  })
})
