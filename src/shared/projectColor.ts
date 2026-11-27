export interface ProjectColor {
  name: string
  bg: string
  fg: string
}

export const PROJECT_COLORS: readonly ProjectColor[] = [
  { name: 'amber', bg: '#f2b53a', fg: '#2b1b00' },
  { name: 'emerald', bg: '#2fb57a', fg: '#02210f' },
  { name: 'pink', bg: '#c93d86', fg: '#ffffff' },
  { name: 'blue', bg: '#2f68d6', fg: '#ffffff' },
  { name: 'violet', bg: '#7c5ce0', fg: '#ffffff' },
  { name: 'orange', bg: '#e8742a', fg: '#1f0d00' },
  { name: 'teal', bg: '#1ea8a0', fg: '#021f1d' },
  { name: 'rose', bg: '#c93651', fg: '#ffffff' },
  { name: 'sky', bg: '#38a8e8', fg: '#04202f' },
  { name: 'lime', bg: '#8cc63f', fg: '#142200' }
]

function hash(text: string): number {
  let value = 5381
  for (const char of text) value = (Math.imul(value, 33) + (char.codePointAt(0) ?? 0)) >>> 0
  return value
}

/** The same name always gets the same colour: case and surrounding spaces do not matter. */
export function projectColor(name: string): ProjectColor {
  return PROJECT_COLORS[hash(name.trim().toLowerCase()) % PROJECT_COLORS.length]
}

function channel(hex: string, start: number): number {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}
