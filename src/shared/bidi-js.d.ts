declare module 'bidi-js' {
  interface EmbeddingLevels {
    levels: Uint8Array
    paragraphs: { start: number; end: number; level: number }[]
  }
  interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): EmbeddingLevels
    getReorderSegments(text: string, levels: EmbeddingLevels, start?: number, end?: number): [number, number][]
  }
  export default function bidiFactory(): Bidi
}
