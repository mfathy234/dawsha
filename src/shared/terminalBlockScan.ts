import { parseBlocks, type Block, type BlockLine, type BlockOptions } from './terminalBlocks'

export interface BlockSource {
  length: number
  /** Rows above this are scrollback: programs cannot redraw them, so blocks that end there are final. */
  stable: number
  /** The lines in a row range, wrapped rows joined. */
  lines(from: number, to: number): BlockLine[]
  /** Whether the row continues the line above it. */
  isWrapped(row: number): boolean
}

interface Settled {
  blocks: Block[]
  from: number
  anchor: string
  length: number
  key: string
}

const keyOf = (options: BlockOptions, below: number): string =>
  JSON.stringify([
    options.agent ?? null,
    [...(options.promptRows ?? [])].filter((row) => row < below).sort((a, b) => a - b),
    (options.commands ?? []).filter((command) => command.row < below)
  ])

/**
 * Scans a buffer into blocks, resuming from the last block that starts in the scrollback. Blocks before it ended there and are final; it and the ones after it can still change.
 * The result is always what `parseBlocks` gives for the whole buffer; when the rows above the resume point may have changed (trimmed, cleared, rewrapped, other options) it scans everything.
 */
export class BlockScanner {
  private settled: Settled | null = null

  reset(): void {
    this.settled = null
  }

  scan(source: BlockSource, options: BlockOptions): Block[] {
    const resumed = this.resume(source, options)
    const blocks = resumed ?? parseBlocks(source.lines(0, source.length - 1), options)
    this.remember(source, options, blocks)
    return blocks
  }

  private resume(source: BlockSource, options: BlockOptions): Block[] | null {
    const settled = this.settled
    if (!settled || source.length < settled.length) return null
    if (options.liveFromRow !== undefined && options.liveFromRow <= settled.from) return null
    if (source.isWrapped(settled.from) || source.lines(settled.from, settled.from)[0]?.text !== settled.anchor) return null
    if (keyOf(options, settled.from) !== settled.key) return null
    const tail = parseBlocks(source.lines(settled.from, source.length - 1), options)
    return tail.length === 0 ? null : [...settled.blocks, ...tail]
  }

  private remember(source: BlockSource, options: BlockOptions, blocks: readonly Block[]): void {
    let at = -1
    for (let index = 0; index < blocks.length && blocks[index].startRow < source.stable; index += 1) at = index
    const resumeAt = at >= 0 ? blocks[at] : undefined
    const anchor = resumeAt ? source.lines(resumeAt.startRow, resumeAt.startRow)[0]?.text : undefined
    this.settled = resumeAt && anchor !== undefined
      ? { blocks: blocks.slice(0, at), from: resumeAt.startRow, anchor, length: source.length, key: keyOf(options, resumeAt.startRow) }
      : null
  }
}
