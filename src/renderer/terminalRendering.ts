import { ImageAddon } from '@xterm/addon-image'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import type { IDisposable, Terminal } from '@xterm/xterm'
import { sixelWithinLimits, TERMINAL_IMAGE_BYTE_LIMIT, TERMINAL_IMAGE_PIXEL_LIMIT } from '../shared/sixelLimits'

const IMAGE_STORAGE_MB = 32

export class TerminalRendering {
  private images: ImageAddon | null = null
  private ligatures: LigaturesAddon | null = null
  private imagesEnabled = false
  private imageBlockers: IDisposable[] = []
  private imageBudget: IDisposable | null = null
  private sixelGuard: IDisposable | null = null

  constructor(private readonly term: Terminal) {}

  setLigatures(enabled: boolean): void {
    if (!this.term.element || enabled === (this.ligatures !== null)) return
    if (enabled) {
      const ligatures = new LigaturesAddon({ fontFeatureSettings: '"calt" on, "liga" on' })
      this.term.loadAddon(ligatures)
      this.ligatures = ligatures
    } else {
      this.ligatures?.dispose()
      this.ligatures = null
    }
    this.term.refresh(0, this.term.rows - 1)
  }

  setImages(enabled: boolean): void {
    if (enabled === this.imagesEnabled) return
    this.imagesEnabled = enabled
    for (const blocker of this.imageBlockers) blocker.dispose()
    this.imageBlockers = []
    if (enabled && !this.images) {
      const images = new ImageAddon({
        storageLimit: IMAGE_STORAGE_MB,
        pixelLimit: TERMINAL_IMAGE_PIXEL_LIMIT,
        sixelSizeLimit: TERMINAL_IMAGE_BYTE_LIMIT,
        iipSizeLimit: TERMINAL_IMAGE_BYTE_LIMIT,
        showPlaceholder: false,
        enableSizeReports: false
      })
      this.term.loadAddon(images)
      this.images = images
      // Public DCS handlers run before the addon's finalizer, including on split writes.
      this.sixelGuard = this.term.parser.registerDcsHandler({ final: 'q' }, (data) => !sixelWithinLimits(data))
      this.imageBudget = this.term.onRender(() => {
        if (!this.imagesEnabled && images.storageUsage > 0) images.reset()
        // The addon does not enforce its storage limit when zoom creates scaled copies.
        if (images.storageUsage > IMAGE_STORAGE_MB) {
          images.storageLimit = IMAGE_STORAGE_MB
          this.term.refresh(0, this.term.rows - 1)
        }
      })
    } else if (!enabled) {
      // Keep IDs monotonic: disposing the addon leaves image IDs in buffer cells.
      this.images?.reset()
      this.imageBlockers = [
        this.term.parser.registerDcsHandler({ final: 'q' }, () => true),
        this.term.parser.registerOscHandler(1337, () => true)
      ]
    }
    if (this.term.element) this.term.refresh(0, this.term.rows - 1)
  }

  dispose(): void {
    for (const blocker of this.imageBlockers) blocker.dispose()
    this.imageBudget?.dispose()
    this.sixelGuard?.dispose()
    this.ligatures?.dispose()
    this.images?.dispose()
  }
}
