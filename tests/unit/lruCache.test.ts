import { describe, expect, it } from 'vitest'
import { LruCache } from '../../src/renderer/chat/lruCache'

describe('LruCache', () => {
  it('drops the oldest key past its cap', () => {
    const cache = new LruCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(2)
  })

  it('counts a read as use', () => {
    const cache = new LruCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a')
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
  })

  it('replaces a key without growing', () => {
    const cache = new LruCache<number>(2)
    cache.set('a', 1)
    cache.set('a', 5)
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe(5)
  })
})
