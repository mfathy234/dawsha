// Claude Code runs the Unicode BiDi algorithm itself and prints right-to-left text already laid out left-to-right
// (visual order). Copying such a row gives the letters backwards. Running the reordering once more on a visual line
// gives back the reading (logical) order for ordinary text: Arabic with numbers and Latin words in it.
import bidiFactory from 'bidi-js'
import { hasArabic } from './arabicRows'

const bidi = bidiFactory()
const segmenter = new Intl.Segmenter('ar', { granularity: 'grapheme' })

// Layout around the text that Claude draws itself and does not reorder: indentation, bullets, prompt marks, boxes.
const GUTTER = /[\s\u2500-\u25ff\u2190-\u21ff\u2700-\u27bf\u23bf●•❯›>*|]/u
const STRONG_ARABIC = /[\u0600-\u0608\u060b\u060d\u061b-\u064a\u066d-\u066f\u0671-\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u
const STRONG_LTR = /\p{L}/u

const reverseGraphemes = (text: string): string => [...segmenter.segment(text)].map((s) => s.segment).reverse().join('')

/** In visual order the start of a right-to-left sentence is the rightmost strong letter. */
function paragraphDirection(visual: string): 'ltr' | 'rtl' {
  const chars = [...visual]
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (STRONG_ARABIC.test(chars[i])) return 'rtl'
    if (STRONG_LTR.test(chars[i])) return 'ltr'
  }
  return 'ltr'
}

function edges(line: string): { prefix: string; body: string; suffix: string } {
  const chars = [...line]
  let start = 0
  while (start < chars.length && GUTTER.test(chars[start])) start += 1
  let end = chars.length
  while (end > start && GUTTER.test(chars[end - 1])) end -= 1
  return { prefix: chars.slice(0, start).join(''), body: chars.slice(start, end).join(''), suffix: chars.slice(end).join('') }
}

function reorder(text: string, direction: 'ltr' | 'rtl'): string {
  const levels = bidi.getEmbeddingLevels(text, direction)
  let out = text
  for (const [start, end] of bidi.getReorderSegments(text, levels)) {
    out = out.slice(0, start) + reverseGraphemes(out.slice(start, end + 1)) + out.slice(end + 1)
  }
  return out
}

/** One line in visual order back to reading order. Lines without Arabic come back unchanged. */
export function logicalFromVisual(line: string): string {
  if (!hasArabic(line)) return line
  const { prefix, body, suffix } = edges(line)
  if (body === '') return line
  return prefix + reorder(body, paragraphDirection(body)) + suffix
}

/** Reading order to the visual order Claude Code prints, so a typed search finds its rows. */
export function visualFromLogical(text: string): string {
  if (!hasArabic(text)) return text
  const first = [...text].find((char) => STRONG_ARABIC.test(char) || STRONG_LTR.test(char))
  return reorder(text, first && STRONG_ARABIC.test(first) ? 'rtl' : 'ltr')
}

/** Every line of a block of visual-order text back to reading order. */
export const logicalText = (text: string): string => text.split('\n').map(logicalFromVisual).join('\n')
