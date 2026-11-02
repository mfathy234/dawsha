import type { ChatItem } from '../../shared/chatLog'
import type { ImageEntry } from './imageTable'

export interface ReaderStats {
  /** JSON records read so far. */
  lines: number
  /** Records of a kind this reader understands. */
  known: number
}

export interface ChatLineReader {
  feed(text: string): void
  items(): ChatItem[]
  readonly earlier: number
  readonly stats: ReaderStats
  /** What a picture id from this reader's items points at; undefined once it was evicted. */
  image(id: string): ImageEntry | undefined
}

/** A log of several records that has none the reader understands: the format changed or this is not that agent's log. */
export const UNRECOGNISED_AFTER = 5

export const unrecognised = (stats: ReaderStats): boolean => stats.lines >= UNRECOGNISED_AFTER && stats.known === 0
