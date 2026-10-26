const channel = (value: number): number => {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean.slice(0, 6)
  const num = Number.parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`
}

export function shadowRgb(background: string, text: string, kind: 'dark' | 'light'): string {
  const [r, g, b] = kind === 'dark' ? parseHex(background).map((c) => Math.round(c * 0.35)) : parseHex(text)
  return `${r} ${g} ${b}`
}
