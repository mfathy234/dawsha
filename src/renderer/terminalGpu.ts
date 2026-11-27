interface Renderer { visible(): boolean; release(): void }
const renderers = new Map<string, Renderer>()
const MAX_RENDERERS = 12

/** Leave room for the browser and other canvases; hidden contexts yield first. */
export function reserveRenderer(id: string, renderer: Renderer): boolean {
  if (renderers.has(id)) return true
  if (renderers.size >= MAX_RENDERERS) {
    const hidden = [...renderers].find(([, entry]) => !entry.visible())
    if (!hidden) return false
    renderers.delete(hidden[0])
    hidden[1].release()
  }
  renderers.set(id, renderer)
  return true
}

export const releaseRenderer = (id: string): void => { renderers.delete(id) }
