import type { ITheme, Terminal } from '@xterm/xterm'
import { logicalRuns } from './terminalCells'
import type { BlockLine } from '../shared/terminalBlocks'

const SCALE = 2
const PAD = 12
const MAX_ROWS = 300

export interface ImageStyle {
  font: string
  size: number
  theme: ITheme
}

/** The given lines drawn the way the terminal shows them, in the current theme, as a PNG. */
export async function renderLinesPng(term: Terminal, lines: readonly BlockLine[], style: ImageStyle): Promise<Blob | null> {
  const picked = lines.slice(0, MAX_ROWS)
  if (picked.length === 0) return null
  const lineHeight = Math.ceil(style.size * 1.35)
  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) return null
  measure.font = `${style.size}px ${style.font}`
  const cell = measure.measureText('M').width
  const width = Math.ceil(PAD * 2 + Math.min(term.cols, widest(picked)) * cell)
  const height = PAD * 2 + picked.length * lineHeight
  const canvas = document.createElement('canvas')
  canvas.width = width * SCALE
  canvas.height = height * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = style.theme.background ?? '#000000'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'middle'
  picked.forEach((line, index) => drawLine(ctx, term, line, index, { cell, lineHeight, style }))
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}

const widest = (lines: readonly BlockLine[]): number => Math.max(1, ...lines.map((line) => Array.from(line.text.replace(/\s+$/, '')).length))

interface Metrics {
  cell: number
  lineHeight: number
  style: ImageStyle
}

function drawLine(ctx: CanvasRenderingContext2D, term: Terminal, line: BlockLine, index: number, metrics: Metrics): void {
  const { cell, lineHeight, style } = metrics
  const y = PAD + index * lineHeight
  let x = PAD
  for (const run of logicalRuns(term, line.row, line.rows, style.theme)) {
    ctx.font = `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${style.size}px ${style.font}`
    const cells = Array.from(run.text).reduce((sum, ch) => sum + (ch.codePointAt(0)! > 0x2e80 ? 2 : 1), 0)
    const runWidth = cells * cell
    if (run.bg) {
      ctx.fillStyle = run.bg
      ctx.fillRect(x, y, runWidth, lineHeight)
    }
    ctx.globalAlpha = run.dim ? 0.7 : 1
    ctx.fillStyle = run.fg ?? style.theme.foreground ?? '#ffffff'
    ctx.fillText(run.text, x, y + lineHeight / 2)
    ctx.globalAlpha = 1
    x += runWidth
  }
}
