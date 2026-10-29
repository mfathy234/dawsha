import { expect, it } from 'vitest'
import { estimateCost, priceLookupFor } from '../../src/shared/agentCosts'

it('keeps built-in token pricing available to background agents', () => {
  const lookup = priceLookupFor()
  const price = lookup('claude', 'sonnet')
  expect(price).toEqual({ inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.2, cacheWritePerM: 2.5 })
  if (price && price !== 'free') {
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }, price)).toBe(14.7)
  }
  expect(lookup('codex-local', 'anything')).toBe('free')
  expect(lookup('codex', 'unknown')).toBeNull()
})

it('falls back to input rates when cache prices are absent', () => {
  expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }, { inputPerM: 2, outputPerM: 10 })).toBe(6)
})
