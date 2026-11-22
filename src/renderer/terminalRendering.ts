import { ImageAddon } from '@xterm/addon-image'
import type { Terminal } from '@xterm/xterm'

export class TerminalRendering {
  private images: ImageAddon | null = null

  constructor(private readonly term: Terminal) {}

  setImages(enabled: boolean): void {
    if (enabled === (this.images !== null)) return
    if (enabled) {
      const images = new ImageAddon({
        storageLimit: 32,
        pixelLimit: 4_000_000,
        sixelSizeLimit: 8_000_000,
        iipSizeLimit: 8_000_000,
        enableSizeReports: false
      })
      this.term.loadAddon(images)
      this.images = images
    } else {
      this.images?.dispose()
      this.images = null
    }
    if (this.term.element) this.term.refresh(0, this.term.rows - 1)
  }
}
