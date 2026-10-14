import type { SessionState } from './sessionState'

export const APP_TITLE = 'Dawsha'
export const OVERLAY_SIZE = 32

const MAX_BADGE = 99

export function needsCount(states: readonly SessionState[]): number {
  return states.filter((state) => state === 'needs').length
}

export function normalizeBadgeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_BADGE, Math.max(0, Math.floor(value))) : 0
}

export function badgeWindowTitle(count: number): string {
  return count > 0 ? `(${count}) ${APP_TITLE}` : APP_TITLE
}

const GLYPHS: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
}

const AMBER = [0x24, 0xa5, 0xf5]
const INK = [0x04, 0x12, 0x1a]

export function overlayLabel(count: number): string {
  return count > 9 ? '9+' : String(Math.max(0, count))
}

/** A 32x32 BGRA bitmap: an amber disc with the count drawn in a tiny pixel font. */
export function overlayBitmap(count: number): Buffer {
  const size = OVERLAY_SIZE
  const data = Buffer.alloc(size * size * 4)
  const put = (x: number, y: number, color: number[]): void => {
    const at = (y * size + x) * 4
    data[at] = color[0]
    data[at + 1] = color[1]
    data[at + 2] = color[2]
    data[at + 3] = 255
  }
  const radius = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x + 0.5 - radius) ** 2 + (y + 0.5 - radius) ** 2 <= (radius - 0.5) ** 2) put(x, y, AMBER)
    }
  }
  const label = overlayLabel(count)
  const scale = label.length > 1 ? 3 : 4
  const width = label.length * 3 * scale + (label.length - 1) * scale
  const left = Math.round((size - width) / 2)
  const top = Math.round((size - 5 * scale) / 2)
  Array.from(label).forEach((char, index) => {
    const originX = left + index * 4 * scale
    GLYPHS[char].forEach((row, gy) => {
      Array.from(row).forEach((cell, gx) => {
        if (cell !== '1') return
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) put(originX + gx * scale + dx, top + gy * scale + dy, INK)
        }
      })
    })
  })
  return data
}
