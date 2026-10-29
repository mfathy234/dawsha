import { describe, expect, it } from 'vitest'
import {
  canAnswerApproval,
  defaultCapabilities,
  isCapabilityPatch,
  REMOTE_CAPABILITIES,
  REMOTE_CAPABILITY_INFO,
  sanitizeCapabilities
} from '../../src/shared/remoteCapabilities'
import { agoLabel, deviceIsActive, lastSeenLabel, statusCopy } from '../../src/shared/remoteStatus'

describe('remote capabilities', () => {
  it('start with every capability off and have copy for each one', () => {
    expect(Object.values(defaultCapabilities()).every((value) => value === false)).toBe(true)
    for (const capability of REMOTE_CAPABILITIES) expect(REMOTE_CAPABILITY_INFO[capability].label).toBeTruthy()
  })

  it('keeps only known capabilities that are exactly true', () => {
    expect(sanitizeCapabilities({ commands: true, answers: 'yes', fullOutput: 1, crew: true })).toEqual({ ...defaultCapabilities(), commands: true })
  })

  it('migrates the old settings, and never grants full output', () => {
    expect(sanitizeCapabilities(undefined, { approvals: true, terminalInput: true, sessionControl: false })).toEqual({ commands: true, answers: true, messages: true, sessions: false, fullOutput: false })
    expect(sanitizeCapabilities('junk', undefined)).toEqual(defaultCapabilities())
  })

  it('accepts a patch only of known boolean capabilities', () => {
    expect(isCapabilityPatch({ commands: true })).toBe(true)
    expect(isCapabilityPatch({})).toBe(true)
    expect(isCapabilityPatch({ commands: 'yes' })).toBe(false)
    expect(isCapabilityPatch({ crew: true })).toBe(false)
    expect(isCapabilityPatch([true])).toBe(false)
    expect(isCapabilityPatch(null)).toBe(false)
  })

  it('maps questions and plans to answers, and commands and edits to commands', () => {
    const onlyAnswers = { commands: false, answers: true }
    const onlyCommands = { commands: true, answers: false }
    expect(canAnswerApproval(onlyAnswers, 'other')).toBe(true)
    expect(canAnswerApproval(onlyAnswers, 'command')).toBe(false)
    expect(canAnswerApproval(onlyAnswers, 'edit')).toBe(false)
    expect(canAnswerApproval(onlyCommands, 'command')).toBe(true)
    expect(canAnswerApproval(onlyCommands, 'edit')).toBe(true)
    expect(canAnswerApproval(onlyCommands, 'other')).toBe(false)
  })
})

describe('Remote Access status copy', () => {
  const base = { droppedAt: null, message: '', now: 10 * 60_000 }

  it('says plainly when the phone can reach this PC', () => {
    expect(statusCopy({ ...base, status: 'available' })).toMatchObject({ kind: 'on', title: 'Your phone can reach this PC' })
  })

  it('says how long ago the tunnel dropped and that a re-scan is needed', () => {
    const copy = statusCopy({ ...base, status: 'dropped', droppedAt: 8 * 60_000 })
    expect(copy).toMatchObject({ kind: 'dropped', title: 'The tunnel dropped 2 minutes ago' })
    expect(copy.detail).toBe('Your phone cannot reach this PC. Reconnecting gives a new link, so re-scan the code.')
  })

  it('says it is off, or that it could not start, or that it is busy', () => {
    expect(statusCopy({ ...base, status: 'off' })).toMatchObject({ kind: 'off', title: 'Remote Access is off' })
    expect(statusCopy({ ...base, status: 'setup-required', message: 'No internet.' })).toMatchObject({ kind: 'off', detail: 'No internet.' })
    expect(statusCopy({ ...base, status: 'reconnecting' }).kind).toBe('busy')
    expect(statusCopy({ ...base, status: 'connecting', message: 'Publishing.' })).toMatchObject({ kind: 'busy', detail: 'Publishing.' })
  })

  it('words ages and phone activity in plain language', () => {
    expect(agoLabel(10_000)).toBe('less than a minute ago')
    expect(agoLabel(60_000)).toBe('1 minute ago')
    expect(agoLabel(3 * 3_600_000)).toBe('3 hours ago')
    expect(deviceIsActive(100_000, 130_000)).toBe(true)
    expect(deviceIsActive(0, 130_000)).toBe(false)
    expect(lastSeenLabel(0, 130_000)).toBe('Last seen 2 minutes ago')
    expect(lastSeenLabel(120_000, 130_000)).toBe('Active now')
  })
})

describe('PIN email validation', () => {
  it('accepts a plain address and rejects blanks, spaces and missing parts', async () => {
    const { isValidPinEmail } = await import('../../src/shared/remoteStatus')
    expect(isValidPinEmail('me@example.com')).toBe(true)
    for (const bad of ['', 'me', 'me@example', '@example.com', 'me @example.com', `${'a'.repeat(250)}@x.co`]) expect(isValidPinEmail(bad)).toBe(false)
  })
})
