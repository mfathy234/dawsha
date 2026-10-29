/** Cache Storage name the old speech engine wrote its model files to (the transformers.js default). Only this cache is removed. */
export const LEGACY_MODEL_CACHE = 'transformers-cache'

export interface NamedCacheStorage {
  delete(name: string): Promise<boolean>
}

/** True when there was a cache to remove; false when this PC never had one. */
export async function removeLegacyModelCache(storage: NamedCacheStorage = caches): Promise<boolean> {
  return storage.delete(LEGACY_MODEL_CACHE)
}
