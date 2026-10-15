import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type RemotePermission = 'read' | 'terminalInput' | 'sessionControl' | 'approvals'

export interface StoredDevice {
  id: string
  name: string
  tokenHash: string
  pairedAt: number
  lastSeenAt: number
}

export interface DeviceStore {
  load(): StoredDevice[]
  save(devices: StoredDevice[]): void
}

export interface PairedDevice {
  id: string
  name: string
  pairedAt: number
  lastSeenAt: number
}

export interface PairingCode {
  code: string
  expiresAt: number
}

const PAIRING_TTL_MS = 5 * 60 * 1000
const MAX_PAIRING_ATTEMPTS = 5
const TOKEN_BYTES = 32
const LAST_SEEN_PERSIST_MS = 60_000
export const REMOTE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function matchesDigest(token: string, expectedHex: string): boolean {
  const actual = Buffer.from(tokenDigest(token), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function deviceView(device: StoredDevice): PairedDevice {
  return { id: device.id, name: device.name, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt }
}

export function createFileDeviceStore(filePath: string): DeviceStore {
  return {
    load(): StoredDevice[] {
      try {
        const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
        if (!Array.isArray(raw) || !raw.every(isStoredDevice)) throw new Error('Invalid paired-device data.')
        return raw
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw new Error(`Could not read paired-device data: ${(error as Error).message}`)
      }
    },
    save(devices): void {
      mkdirSync(dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`
      try {
        writeFileSync(temporaryPath, JSON.stringify(devices), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        renameSync(temporaryPath, filePath)
      } catch (error) {
        try { unlinkSync(temporaryPath) } catch { /* best-effort temporary-file cleanup */ }
        throw new Error(`Could not save paired-device data: ${(error as Error).message}`)
      }
    }
  }
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.name === 'string' &&
    typeof record.tokenHash === 'string' && /^[a-f0-9]{64}$/.test(record.tokenHash) &&
    typeof record.pairedAt === 'number' && typeof record.lastSeenAt === 'number'
}

export function createRemoteAuth(store: DeviceStore, now: () => number = Date.now) {
  let devices = store.load()
  const lastPersistedSeen = new Map(devices.map((device) => [device.id, device.lastSeenAt]))
  let permissions = { terminalInput: false, sessionControl: false, approvals: false }
  let pairing: { code: string; expiresAt: number; attempts: number } | null = null
  const revocationListeners = new Set<(deviceId: string) => void>()

  function createPairingCode(): PairingCode {
    const code = String(randomInt(100000, 1000000))
    const expiresAt = now() + PAIRING_TTL_MS
    pairing = { code, expiresAt, attempts: 0 }
    return { code, expiresAt }
  }

  function pair(code: string, deviceName: string): { deviceId: string; token: string } | null {
    if (!pairing) return null
    const active = pairing
    if (now() >= active.expiresAt || active.attempts >= MAX_PAIRING_ATTEMPTS) {
      pairing = null
      return null
    }
    active.attempts += 1
    const submitted = Buffer.from(String(code).padEnd(6, '\0').slice(0, 6))
    const expected = Buffer.from(active.code)
    const valid = /^\d{6}$/.test(code) && timingSafeEqual(submitted, expected)
    if (!valid) {
      if (active.attempts >= MAX_PAIRING_ATTEMPTS) pairing = null
      return null
    }

    pairing = null
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const id = randomBytes(16).toString('hex')
    const safeName = deviceName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Browser'
    const timestamp = now()
    devices = [...devices, { id, name: safeName, tokenHash: tokenDigest(token), pairedAt: timestamp, lastSeenAt: timestamp }]
    store.save(devices)
    return { deviceId: id, token }
  }

  function authorize(token: string): PairedDevice | null {
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null
    const device = devices.find((candidate) => matchesDigest(token, candidate.tokenHash))
    if (!device) return null
    if (now() >= device.pairedAt + REMOTE_TOKEN_TTL_MS) {
      revoke(device.id)
      return null
    }
    const updated = { ...device, lastSeenAt: now() }
    devices = devices.map((candidate) => candidate.id === device.id ? updated : candidate)
    if (updated.lastSeenAt - (lastPersistedSeen.get(device.id) ?? 0) >= LAST_SEEN_PERSIST_MS) {
      store.save(devices)
      lastPersistedSeen.set(device.id, updated.lastSeenAt)
    }
    return deviceView(updated)
  }

  function revoke(deviceId: string): boolean {
    const next = devices.filter((device) => device.id !== deviceId)
    if (next.length === devices.length) return false
    devices = next
    store.save(devices)
    for (const listener of [...revocationListeners]) {
      try { listener(deviceId) } catch { /* revoke must complete even if a live client fails to close */ }
    }
    return true
  }

  function onRevoke(listener: (deviceId: string) => void): () => void {
    revocationListeners.add(listener)
    return () => revocationListeners.delete(listener)
  }

  function can(token: string, permission: RemotePermission): boolean {
    if (!authorize(token)) return false
    return permission === 'read' || permissions[permission]
  }

  function setPermissions(next: Partial<typeof permissions>): void {
    permissions = {
      terminalInput: next.terminalInput ?? permissions.terminalInput,
      sessionControl: next.sessionControl ?? permissions.sessionControl,
      approvals: next.approvals ?? permissions.approvals
    }
  }

  function listDevices(): PairedDevice[] {
    return devices.map(deviceView)
  }

  return { createPairingCode, pair, authorize, revoke, can, setPermissions, listDevices, onRevoke }
}

export type RemoteAuth = ReturnType<typeof createRemoteAuth>
