import type { GridSplit, GridSplits } from './types'

export const MIN_PANE_WIDTH = 260
export const MIN_PANE_HEIGHT = 140
export const MAX_SPLIT_SHAPES = 24
export const SPLIT_STEP = 24

export const shapeKey = (cols: number, rows: number, variant = ''): string => `${cols}x${rows}${variant}`

// The tall-first shapes open with a wider first column instead of equal ones.
export function defaultSplit(cols: number, rows: number, variant = ''): GridSplit {
  const wide = variant === 'b' ? (cols === 2 ? [0.57, 0.43] : cols === 3 ? [0.4, 0.3, 0.3] : null) : null
  return { cols: wide ?? equalSizes(cols), rows: equalSizes(rows) }
}

const sameSizes = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((size, index) => Math.abs(size - b[index]) < 1e-6)

export const equalSizes = (count: number): number[] =>
  Array.from({ length: Math.max(1, count) }, () => 1 / Math.max(1, count))

export function normalizeSizes(sizes: unknown, count: number): number[] {
  if (!Array.isArray(sizes) || sizes.length !== count) return equalSizes(count)
  if (!sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size > 0)) return equalSizes(count)
  const total = (sizes as number[]).reduce((sum, size) => sum + size, 0)
  return (sizes as number[]).map((size) => size / total)
}

export function isEqualSizes(sizes: number[]): boolean {
  return sizes.every((size) => Math.abs(size - 1 / sizes.length) < 1e-6)
}

export function applyDelta(
  sizes: number[],
  boundary: number,
  deltaPx: number,
  totalPx: number,
  minPx: number
): number[] {
  if (boundary < 0 || boundary >= sizes.length - 1 || !(totalPx > 0) || !Number.isFinite(deltaPx)) return sizes
  const before = sizes[boundary]
  const after = sizes[boundary + 1]
  const pair = before + after
  const floor = Math.min(minPx / totalPx, pair / 2)
  const next = Math.min(pair - floor, Math.max(floor, before + deltaPx / totalPx))
  const result = [...sizes]
  result[boundary] = next
  result[boundary + 1] = pair - next
  return result
}

const orDefault = (sizes: unknown, fallback: number[]): number[] =>
  Array.isArray(sizes) && sizes.length === fallback.length ? normalizeSizes(sizes, fallback.length) : fallback

export function resolveSplit(splits: GridSplits | undefined, cols: number, rows: number, variant = ''): GridSplit {
  const stored = splits?.[shapeKey(cols, rows, variant)]
  const base = defaultSplit(cols, rows, variant)
  return { cols: orDefault(stored?.cols, base.cols), rows: orDefault(stored?.rows, base.rows) }
}

export function withSplit(
  splits: GridSplits,
  cols: number,
  rows: number,
  axis: 'cols' | 'rows',
  sizes: number[],
  variant = ''
): GridSplits {
  const key = shapeKey(cols, rows, variant)
  const current = resolveSplit(splits, cols, rows, variant)
  const next: GridSplit = { ...current, [axis]: sizes }
  const base = defaultSplit(cols, rows, variant)
  if (sameSizes(next.cols, base.cols) && sameSizes(next.rows, base.rows)) {
    const { [key]: _removed, ...rest } = splits
    return rest
  }
  return { ...splits, [key]: next }
}

export function sanitizeSplits(value: unknown): GridSplits | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const result: GridSplits = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const match = /^([1-9]\d?)x([1-9]\d{0,2})(b?)$/.exec(key)
    if (!match || typeof raw !== 'object' || raw === null) continue
    const cols = Number(match[1])
    const rows = Number(match[2])
    const item = raw as Record<string, unknown>
    const split: GridSplit = { cols: normalizeSizes(item.cols, cols), rows: normalizeSizes(item.rows, rows) }
    const base = defaultSplit(cols, rows, match[3])
    if (sameSizes(split.cols, base.cols) && sameSizes(split.rows, base.rows)) continue
    result[key] = split
    if (Object.keys(result).length >= MAX_SPLIT_SHAPES) break
  }
  return Object.keys(result).length > 0 ? result : undefined
}
