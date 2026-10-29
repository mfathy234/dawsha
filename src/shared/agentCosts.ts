/** USD per million tokens. Cache prices fall back to the input price when not set. */
export interface ModelPrice {
  inputPerM: number
  outputPerM: number
  cacheReadPerM?: number
  cacheWritePerM?: number
}

export type PriceLookup = (runner: string, model: string) => ModelPrice | 'free' | null

/** Built-in list prices retained for background-agent cost estimates. */
export const DEFAULT_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude:opus': { inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 5 },
  'claude:sonnet': { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.2, cacheWritePerM: 2.5 },
  'claude:haiku': { inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.01, cacheWritePerM: 0.125 }
}

export function priceLookupFor(): PriceLookup {
  return (runner, model) => runner.endsWith('-local') ? 'free' : DEFAULT_PRICES[`${runner}:${model}`] ?? null
}

export function estimateCost(usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }, price: ModelPrice): number {
  return (
    usage.inputTokens * price.inputPerM +
    usage.outputTokens * price.outputPerM +
    usage.cacheReadTokens * (price.cacheReadPerM ?? price.inputPerM) +
    usage.cacheWriteTokens * (price.cacheWritePerM ?? price.inputPerM)
  ) / 1_000_000
}
