export interface ProjectColor {
  name: string
  color: string
}

export const PROJECT_COLORS: readonly ProjectColor[] = [
  { name: 'blue', color: '#7c9cd6' },
  { name: 'green', color: '#8fb38a' },
  { name: 'clay', color: '#c58a6b' },
  { name: 'violet', color: '#b48ac0' },
  { name: 'teal', color: '#6fb3b0' },
  { name: 'sand', color: '#c9a66b' },
  { name: 'slate', color: '#8a9bb0' },
  { name: 'rose', color: '#c07f8f' }
]

/** How strongly a project's colour tints its avatar in the expanded sidebar, per theme kind. */
export const AVATAR_TINT = { dark: 0.1, light: 0.14 } as const
/** In a light theme the avatar's letters are the colour pulled toward the text colour, so they stay readable. */
export const LIGHT_LETTER_MIX = 0.4

function hash(text: string): number {
  let value = 5381
  for (const char of text) value = (Math.imul(value, 33) + (char.codePointAt(0) ?? 0)) >>> 0
  return value
}

export const isProjectColor = (value: unknown): value is string => typeof value === 'string' && PROJECT_COLORS.some((entry) => entry.color === value)

/** The same name always gets the same colour: case and surrounding spaces do not matter. */
export function projectColor(name: string): ProjectColor {
  return PROJECT_COLORS[hash(name.trim().toLowerCase()) % PROJECT_COLORS.length]
}

/** The colour the owner picked for a project, or the one its name hashes to. */
export function colorOfProject(project: { name: string; color?: string }): ProjectColor {
  return PROJECT_COLORS.find((entry) => entry.color === project.color) ?? projectColor(project.name)
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

/** `amount` of `top` over `base`, both #rrggbb, like CSS color-mix in sRGB. */
export function mixHex(top: string, base: string, amount: number): string {
  const part = (start: number): string => Math.round(parseInt(top.slice(start, start + 2), 16) * amount + parseInt(base.slice(start, start + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')
  return `#${part(1)}${part(3)}${part(5)}`
}
