import { describe, expect, it } from 'vitest'
import { removeLegacyModelCache } from '../../src/renderer/legacyModelCache'

describe('legacy model cache cleanup', () => {
  it('removes only the known model cache and preserves unrelated caches', async () => {
    const names = new Set(['transformers-cache', 'previews', 'other-app-cache'])
    await removeLegacyModelCache({ delete: async (name) => names.delete(name) })
    expect([...names]).toEqual(['previews', 'other-app-cache'])
  })

  it('is harmless on fresh installations and repeated starts', async () => {
    const names = new Set(['previews'])
    const storage = { delete: async (name: string) => names.delete(name) }
    await removeLegacyModelCache(storage)
    await removeLegacyModelCache(storage)
    expect([...names]).toEqual(['previews'])
  })

  it('allows a failed deletion to be retried on the next start', async () => {
    await expect(removeLegacyModelCache({ delete: async () => { throw new Error('storage busy') } })).rejects.toThrow('storage busy')
    const names = new Set(['transformers-cache'])
    await removeLegacyModelCache({ delete: async (name) => names.delete(name) })
    expect([...names]).toEqual([])
  })
})
