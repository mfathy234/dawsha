/** Where focus and selection go in a radio group of `count` options when `key` is pressed, or null when the key is not one the group handles. */
export function swatchTarget(count: number, current: number, key: string, rtl = false): number | null {
  if (count <= 0) return null
  const step = rtl ? -1 : 1
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + (key === 'ArrowRight' ? step : 1) + count) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - (key === 'ArrowLeft' ? step : 1) + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
