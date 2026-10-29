/** Cache Storage name the old speech engine wrote its model files to (the transformers.js default). Only this cache is removed. */
export const LEGACY_MODEL_CACHE = 'transformers-cache'

export interface NamedCacheStorage {
  delete(name: string): Promise<boolean>
}

export async function removeLegacyModelCache(storage: NamedCacheStorage = caches): Promise<void> {
  await storage.delete(LEGACY_MODEL_CACHE)
}
