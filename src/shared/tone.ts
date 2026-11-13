import { contrastRatio, parseHex } from './contrast'
import type { AppColors } from './themes'
import { mix, type ThemeKind } from './themeLadder'
import type { Tone } from './appearance'

const WARM_HUE = 60
const MIN_TEXT_CONTRAST = 4.5

interface Hsl {
  h: number
  s: number
  l: number
}

const toHex = (channels: readonly number[]): string =>
  `#${channels.map((c) => Math.round(Math.min(255, Math.max(0, c * 255))).toString(16).padStart(2, '0')).join('')}`

function toHsl(hex: string): Hsl {
  const [r, g, b] = parseHex(hex).map((value) => value / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return { h: (raw * 60 + 360) % 360, s, l }
}

function fromHsl({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const sector = Math.floor(h / 60) % 6
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector]
  return toHex([r + m, g + m, b + m])
}

/** The same lightness as `hex` with almost no colour: a neutral grey with a faint warm cast. */
export function neutralise(hex: string, saturation: number): string {
  const { l } = toHsl(hex)
  return fromHsl({ h: WARM_HUE, s: saturation, l })
}

const SURFACE_SATURATION: Record<ThemeKind, number> = { dark: 0.015, light: 0.03 }
const BORDER_SATURATION = 0.03
const TEXT_SATURATION: Record<ThemeKind, number> = { dark: 0.09, light: 0.05 }
const MUTED_SATURATION = 0.05

const SURFACES = ['background', 'sidebar', 'surface', 'raised', 'overlay', 'well'] as const

/** Moves `colour` toward the extreme of its kind until it reads on every surface, or returns it as is when it already does. */
function readable(colour: string, surfaces: readonly string[], kind: ThemeKind): string {
  const target = kind === 'dark' ? '#ffffff' : '#000000'
  for (let step = 0; step <= 10; step += 1) {
    const candidate = step === 0 ? colour : mix(colour, target, step / 10)
    if (surfaces.every((surface) => contrastRatio(candidate, surface) >= MIN_TEXT_CONTRAST)) return candidate
  }
  return target
}

/**
 * The warm tone: the surface ladder, borders and greys of a theme become neutral greys of the same lightness. The accent,
 * status colours and everything else stay as the theme set them, and the text keeps at least 4.5:1 on every surface.
 */
export function warmApp(app: AppColors, kind: ThemeKind): AppColors {
  const surfaceSaturation = SURFACE_SATURATION[kind]
  const surfaces = Object.fromEntries(SURFACES.map((key) => [key, neutralise(app[key], surfaceSaturation)])) as Pick<AppColors, (typeof SURFACES)[number]>
  const list = SURFACES.map((key) => surfaces[key])
  const text = readable(neutralise(app.text, TEXT_SATURATION[kind]), list, kind)
  const muted = readable(neutralise(app.muted, MUTED_SATURATION), list, kind)
  const faint = app.faint === undefined ? undefined : readable(neutralise(app.faint, MUTED_SATURATION), list, kind)
  return { ...app, ...surfaces, border: neutralise(app.border, BORDER_SATURATION), text, muted, ...(faint === undefined ? {} : { faint }) }
}

/** The theme's colours for a tone. Cool is the theme as it is. */
export function toneApp(app: AppColors, kind: ThemeKind, tone: Tone): AppColors {
  return tone === 'warm' ? warmApp(app, kind) : app
}

/** The terminal's own background and cursor ink follow the well in the warm tone, so the terminal reads as part of the card. */
export function toneTerminalBackground(background: string, tone: Tone, kind: ThemeKind): string {
  return tone === 'warm' ? neutralise(background, SURFACE_SATURATION[kind]) : background
}
