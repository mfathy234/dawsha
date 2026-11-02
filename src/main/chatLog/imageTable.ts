import { IMAGE_MAX_BYTES, IMAGE_TABLE_MAX_BYTES, imageSize, mimeFromName, parseImageDataUrl, sniffImageMime, baseName, type ChatImageRef } from '../../shared/chatImage'

export type ImageEntry =
  | { kind: 'bytes'; mime: string; data: Buffer }
  | { kind: 'file'; mime: string; path: string }
  | { kind: 'oversize' }

const FILE_COST = 256

const costOf = (entry: ImageEntry): number => (entry.kind === 'bytes' ? entry.data.length : FILE_COST)

/** The pictures one session's log carried, by id, bounded in bytes: the oldest go first. */
export class ImageTable {
  private entries = new Map<string, ImageEntry>()
  private total = 0

  constructor(private readonly maxBytes = IMAGE_TABLE_MAX_BYTES) {}

  get bytes(): number {
    return this.total
  }

  get size(): number {
    return this.entries.size
  }

  add(id: string, entry: ImageEntry): void {
    this.entries.set(id, entry)
    this.total += costOf(entry)
    for (const [oldest, old] of this.entries) {
      if (this.total <= this.maxBytes || oldest === id) break
      this.entries.delete(oldest)
      this.total -= costOf(old)
    }
  }

  get(id: string): ImageEntry | undefined {
    return this.entries.get(id)
  }
}

/** Makes the references items carry and keeps what they point at. Ids are unique per session. */
export class ImageCollector {
  readonly table: ImageTable
  private counter = 0

  constructor(maxBytes?: number) {
    this.table = new ImageTable(maxBytes)
  }

  private nextId(): string {
    this.counter += 1
    return `img${this.counter}`
  }

  /** A picture whose bytes sit in the log, as base64. Null when it is not one of the shown formats. */
  fromBase64(base64: string, label?: string): ChatImageRef | null {
    if (base64.length > Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 8) return this.oversize(label)
    const data = Buffer.from(base64, 'base64')
    const mime = sniffImageMime(data)
    if (!mime) return null
    const id = this.nextId()
    this.table.add(id, { kind: 'bytes', mime, data })
    return { id, source: 'log', mime, ...imageSize(data), ...(label ? { label } : {}) }
  }

  fromDataUrl(url: string, label?: string): ChatImageRef | null {
    const parsed = parseImageDataUrl(url)
    return parsed ? this.fromBase64(parsed.base64, label) : null
  }

  /** A picture the log only names by path. Whether the path may be read is decided when it is asked for. */
  fromFile(path: string): ChatImageRef | null {
    const mime = mimeFromName(path)
    if (!mime) return null
    const id = this.nextId()
    this.table.add(id, { kind: 'file', mime, path })
    return { id, source: 'file', mime, label: baseName(path) }
  }

  private oversize(label?: string): ChatImageRef {
    const id = this.nextId()
    this.table.add(id, { kind: 'oversize' })
    return { id, source: 'log', mime: 'image/png', ...(label ? { label } : {}) }
  }

  get(id: string): ImageEntry | undefined {
    return this.table.get(id)
  }
}
