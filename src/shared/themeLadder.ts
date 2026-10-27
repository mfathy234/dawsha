import { parseHex } from './contrast'

export type ThemeKind = 'dark' | 'light'

const toHex = (channels: readonly number[]): string =>
  `#${channels.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`

/** `amount` of `to` mixed into `from`, as a hex colour. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  return toHex(a.map((value, index) => value + (b[index] - value) * amount))
}

export interface Ladder {
  canvas: string
  chrome: string
  pane: string
  raised: string
  overlay: string
  well: string
}

/**
 * Dark ladder from the pane colour: chrome and canvas step down toward black, raised and overlay step up,
 * and the well sits between the pane and the canvas. The Dawsha dark theme lands on #0f1217, #07090c,
 * #1d222c, #252b37 and #0d1015 from the pane #161a22.
 */
export function darkLadder(pane: string): Ladder {
  const canvas = mix(pane, '#000000', 0.68)
  return {
    canvas,
    chrome: mix(pane, '#000000', 0.33),
    pane,
    raised: mix(pane, '#ffffff', 0.04),
    overlay: mix(pane, '#ffffff', 0.08),
    well: mix(pane, canvas, 0.6)
  }
}

/**
 * Light ladder: the theme's own tint is the chrome, the canvas is a little darker, panes and raised
 * rows are the pane colour (raised is told apart by a hairline), and the well is halfway to the chrome.
 */
export function lightLadder(pane: string, tint: string): Ladder {
  const chrome = tint
  return {
    canvas: mix(tint, '#000000', 0.055),
    chrome,
    pane,
    raised: pane,
    overlay: pane,
    well: mix(pane, chrome, 0.6)
  }
}

export const ladderFor = (kind: ThemeKind, pane: string, tint: string): Ladder => (kind === 'dark' ? darkLadder(pane) : lightLadder(pane, tint))

export interface Needs {
  fill: string
  text: string
}

/** The one colour for "needs you": an outline and glyph in `fill`, words in `text` (darker on light so it reads at 4.5:1). */
export const needsColours = (kind: ThemeKind): Needs => (kind === 'dark' ? { fill: '#f08a3c', text: '#f08a3c' } : { fill: '#c2620a', text: '#9a4a00' })

export const SEAM = { dark: 'rgb(255 255 255 / .07)', light: 'rgb(24 28 40 / .12)' } as const
