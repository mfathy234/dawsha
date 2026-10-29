import { describe, expect, it, vi } from 'vitest'
import { createRemoteAuth, type DeviceStore, type StoredDevice } from '../../src/main/remoteAuth'

function store(): DeviceStore & { inspect(): StoredDevice[] } {
  let records: StoredDevice[] = []
  return {
    load: () => records,
    save: (next) => { records = next },
    inspect: () => records
  }
}

describe('private remote authentication', () => {
  it('expires pairing codes and prevents reuse', () => {
    let now = 1000
    const auth = createRemoteAuth(store(), () => now)
    const { code, expiresAt } = auth.createPairingCode()
    expect(expiresAt).toBe(301000)
    const paired = auth.pair(code, 'My phone')
    expect(auth.pair(code, 'Second device')).toBeNull()
    expect(auth.authorize(paired!.token)).toMatchObject({ id: paired!.deviceId, name: 'My phone' })

    const nextCode = auth.createPairingCode()
    now = nextCode.expiresAt
    expect(auth.pair(nextCode.code, 'Late device')).toBeNull()
  })

  it('limits guesses, persists only token hashes, and rejects revoked tokens immediately', () => {
    const persisted = store()
    const auth = createRemoteAuth(persisted, () => 1000)
    const { code } = auth.createPairingCode()
    for (let index = 0; index < 5; index++) expect(auth.pair('000000', 'Attacker')).toBeNull()
    expect(auth.pair(code, 'Too late')).toBeNull()

    const { code: validCode } = auth.createPairingCode()
    const paired = auth.pair(validCode, 'Laptop')!
    expect(persisted.inspect().map((device) => device.tokenHash)).not.toContain(paired.token)
    expect(auth.revoke(paired.deviceId)).toBe(true)
    expect(auth.authorize(paired.token)).toBeNull()
  })

  it('keeps read access separate from terminal and session control', () => {
    const auth = createRemoteAuth(store(), () => 1000)
    const { code } = auth.createPairingCode()
    const paired = auth.pair(code, 'Phone')!
    expect(auth.can(paired.token, 'read')).toBe(true)
    expect(auth.can(paired.token, 'messages')).toBe(false)
    expect(auth.can(paired.token, 'sessions')).toBe(false)
    auth.setPermissions({ messages: true })
    expect(auth.can(paired.token, 'messages')).toBe(true)
    expect(auth.can(paired.token, 'sessions')).toBe(false)
  })

  it('gates each capability on its own and treats approvals as commands or answers', () => {
    const auth = createRemoteAuth(store(), () => 1000)
    const paired = auth.pair(auth.createPairingCode().code, 'Phone')!
    for (const capability of ['commands', 'answers', 'messages', 'sessions', 'crew', 'fullOutput'] as const) expect(auth.can(paired.token, capability)).toBe(false)
    expect(auth.can(paired.token, 'approvals')).toBe(false)
    auth.setPermissions({ answers: true })
    expect(auth.can(paired.token, 'approvals')).toBe(true)
    expect(auth.can(paired.token, 'commands')).toBe(false)
    expect(auth.can(paired.token, 'fullOutput')).toBe(false)
    auth.setPermissions({ answers: false, fullOutput: true })
    expect(auth.can(paired.token, 'approvals')).toBe(false)
    expect(auth.can(paired.token, 'fullOutput')).toBe(true)
  })

  it('persists last-seen metadata at most once per minute', () => {
    let now = 1000
    let writes = 0
    let records: StoredDevice[] = []
    const auth = createRemoteAuth({ load: () => records, save: (next) => { records = next; writes += 1 } }, () => now)
    const { code } = auth.createPairingCode()
    const paired = auth.pair(code, 'Phone')!
    auth.authorize(paired.token)
    now += 1000
    auth.authorize(paired.token)
    expect(writes).toBe(1)
  })

  it('expires paired browser tokens after the secure cookie lifetime', () => {
    let now = 1000
    const persisted = store()
    const auth = createRemoteAuth(persisted, () => now)
    const { code } = auth.createPairingCode()
    const paired = auth.pair(code, 'Phone')!

    now += 30 * 24 * 60 * 60 * 1000

    expect(auth.authorize(paired.token)).toBeNull()
    expect(auth.listDevices()).toEqual([])
    expect(persisted.inspect()).toEqual([])
  })

  it('notifies active sessions immediately when a paired device is revoked', () => {
    const auth = createRemoteAuth(store())
    const listener = vi.fn()
    const unsubscribe = auth.onRevoke(listener)
    const { code } = auth.createPairingCode()
    const paired = auth.pair(code, 'Phone')!
    auth.revoke(paired.deviceId)
    expect(listener).toHaveBeenCalledWith(paired.deviceId)
    unsubscribe()
  })
})
