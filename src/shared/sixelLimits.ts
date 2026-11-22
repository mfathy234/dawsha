export const TERMINAL_IMAGE_PIXEL_LIMIT = 4_000_000
export const TERMINAL_IMAGE_BYTE_LIMIT = 8_000_000
const MAX_DIMENSION = 4096

export function sixelWithinLimits(data: string): boolean {
  if (data.length > TERMINAL_IMAGE_BYTE_LIMIT) return false
  let height = 6
  for (let index = 0; index < data.length; index += 1) {
    const char = data[index]
    if (char === '-') {
      height += 6
      if (height > MAX_DIMENSION) return false
    }
    if (char !== '"' && char !== '!') continue
    let end = index + 1
    while (end < data.length && ((data[end] >= '0' && data[end] <= '9') || data[end] === ';')) {
      end += 1
      if (end - index > 64) return false
    }
    const values = data.slice(index + 1, end).split(';').map(Number)
    if (values.some((value) => value > MAX_DIMENSION)) return false
    if (char === '!' && values.length !== 1) return false
    if (char === '"' && (values.length > 4 || (values[2] ?? 0) * (values[3] ?? 0) > TERMINAL_IMAGE_PIXEL_LIMIT)) return false
    index = end - 1
  }
  return true
}
