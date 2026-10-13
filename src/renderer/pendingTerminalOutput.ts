interface BufferedOutput {
  chunks: string[]
  characters: number
}

export class PendingTerminalOutput {
  private readonly entries = new Map<string, BufferedOutput>()

  constructor(private readonly maxTerminals = 32, private readonly maxCharacters = 128 * 1024) {}

  append(id: string, data: string): void {
    if (!data) return
    let entry = this.entries.get(id)
    if (!entry) {
      if (this.entries.size >= this.maxTerminals) {
        const oldest = this.entries.keys().next().value as string | undefined
        if (oldest !== undefined) this.entries.delete(oldest)
      }
      entry = { chunks: [], characters: 0 }
    }

    if (data.length >= this.maxCharacters) {
      entry.chunks = [data.slice(-this.maxCharacters)]
      entry.characters = this.maxCharacters
    } else {
      entry.chunks.push(data)
      entry.characters += data.length
      while (entry.characters > this.maxCharacters) {
        const excess = entry.characters - this.maxCharacters
        const first = entry.chunks[0] ?? ''
        if (first.length <= excess) {
          entry.chunks.shift()
          entry.characters -= first.length
        } else {
          entry.chunks[0] = first.slice(excess)
          entry.characters -= excess
        }
      }
    }
    this.entries.set(id, entry)
  }

  take(id: string): string[] {
    const entry = this.entries.get(id)
    this.entries.delete(id)
    return entry?.chunks ?? []
  }

  delete(id: string): void {
    this.entries.delete(id)
  }
}
