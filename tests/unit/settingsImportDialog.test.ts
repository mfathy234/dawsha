import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const open = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), app: { getPath: () => 'Desktop' }, dialog: { showOpenDialog: open } }))
import { readSettingsImport } from '../../src/main/settingsTransfer'

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

it('opens a JSON file picker on Desktop and treats cancel quietly', async () => {
  vi.stubEnv('DAWSHA_OPEN_PATH', '')
  open.mockResolvedValue({ canceled: true, filePaths: [] })
  expect(await readSettingsImport(null)).toEqual({ status: 'cancelled' })
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'Desktop', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }))
})

it('validates the file returned by the native dialog', async () => {
  vi.stubEnv('DAWSHA_OPEN_PATH', '')
  const path = join(mkdtempSync(join(tmpdir(), 'dawsha-import-dialog-')), 'invalid.json')
  writeFileSync(path, '{}')
  open.mockResolvedValue({ canceled: false, filePaths: [path] })
  expect(await readSettingsImport(null)).toMatchObject({ status: 'error', path })
})
