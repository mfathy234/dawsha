import { sanitizeDiagramSvg } from '../../shared/diagrams'
import { localMermaidError } from '../../shared/mermaidDiagram'
import { api } from '../api'
import { h } from '../dom'
import { currentBundle, onThemeChange } from '../themeManager'
import { loadingNote } from './loadNote'
import './diagrams.css'

export interface DiagramSpec {
  kind: 'plantuml' | 'mermaid'
  folder: string
  path: string
  text: string
  sourceLine?: number
  standalone?: boolean
}

interface DiagramHooks {
  source?(line?: number): void
  openLink(url: string): void
  select?(view: DiagramView): void
}

// Mermaid keeps global configuration. Serialize it so concurrent Markdown blocks
// cannot change each other's theme or leave temporary rendering nodes behind.
let mermaidQueue: Promise<unknown> = Promise.resolve()
let mermaidId = 0

async function renderMermaid(text: string, dark: boolean, current: () => boolean): Promise<string> {
  const run = mermaidQueue.then(async () => {
    if (!current()) return ''
    // Image nodes and CSS can fetch before the resulting SVG reaches our sanitizer.
    // Reject those constructs before Mermaid ever receives the source.
    const error = localMermaidError(text)
    if (error) throw new Error(error)
    const { default: mermaid } = await import('mermaid')
    if (!current()) return ''
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      theme: dark ? 'dark' : 'default',
      suppressErrorRendering: true,
      maxTextSize: 200_000,
      flowchart: { htmlLabels: false },
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'themeCSS', 'htmlLabels', 'fontFamily', 'flowchart', 'themeVariables']
    })
    const host = h('div', { class: 'diagram-render-host', 'aria-hidden': 'true' })
    document.body.append(host)
    try {
      return (await mermaid.render(`dawsha-diagram-${++mermaidId}`, text, host)).svg
    } finally {
      host.remove()
    }
  })
  mermaidQueue = run.catch(() => undefined)
  return run
}

/** A diagram is an inert image, including Mermaid output. Source never becomes app DOM. */
export class DiagramView {
  readonly el = h('section', { class: 'diagram-view', 'aria-label': 'Diagram preview' })
  ready: Promise<void>
  private disposed = false
  private generation = 0
  private svg = ''
  private image: HTMLImageElement | null = null
  private imageUrl = ''
  private stage: HTMLElement | null = null
  private canvas: HTMLElement | null = null
  private zoomValue: HTMLElement | null = null
  private scale = 1
  private sourceShown = false
  private themeDirty = false
  private observer: ResizeObserver | null = null
  private readonly stopTheme: () => void

  constructor(private readonly spec: DiagramSpec, private readonly hooks: DiagramHooks) {
    this.el.addEventListener('pointerdown', () => this.hooks.select?.(this))
    this.el.addEventListener('focusin', () => this.hooks.select?.(this))
    this.el.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && ['0', '+', '=', '-'].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        this.zoom(event.key === '0' ? 1 : this.scale * (event.key === '-' ? 1 / 1.25 : 1.25))
      }
    })
    this.stopTheme = onThemeChange(() => {
      if (spec.kind !== 'mermaid') return
      if (this.sourceShown) this.themeDirty = true
      else this.ready = this.render()
    })
    this.ready = this.render()
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.stopTheme()
    this.clearImage()
  }

  get available(): boolean { return this.svg !== '' }

  async copy(): Promise<void> {
    await this.ready
    if (this.disposed || !this.svg) return
    try {
      const result = await api.diagramCopy(this.svg)
      this.notice(result.ok ? 'Diagram copied as SVG.' : result.error)
    } catch {
      this.notice('Could not copy this diagram to the clipboard.')
    }
  }

  async save(): Promise<void> {
    await this.ready
    if (this.disposed || !this.svg || !this.image) return
    try {
      await this.image.decode()
      if (this.disposed || !this.image) return
      const canvas = document.createElement('canvas')
      const width = this.image.naturalWidth || 1200
      const height = this.image.naturalHeight || 800
      const shrink = Math.min(1, 8192 / width, 8192 / height, Math.sqrt(24_000_000 / (width * height)))
      canvas.width = Math.max(1, Math.round(width * shrink))
      canvas.height = Math.max(1, Math.round(height * shrink))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not prepare the diagram image.')
      context.fillStyle = this.spec.kind === 'plantuml' ? '#ffffff' : currentBundle().theme.app.surface
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(this.image, 0, 0, canvas.width, canvas.height)
      const name = this.spec.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'diagram'
      const result = await api.diagramSave(name, this.svg, canvas.toDataURL('image/png'))
      if (!result.ok) this.notice(result.error)
    } catch (error) {
      this.notice(error instanceof Error ? error.message : 'Could not save this diagram.')
    }
  }

  private notice(message: string): void {
    if (this.disposed) return
    this.el.querySelector('.diagram-notice')?.remove()
    this.el.append(h('p', { class: 'diagram-notice', role: 'status', dir: 'auto' }, message))
  }

  private clearImage(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl)
    this.imageUrl = ''
    this.image = null
    this.stage = null
    this.canvas = null
  }

  private source(): HTMLElement {
    return h('pre', { class: 'diagram-source', dir: 'auto' }, h('code', {}, this.spec.text))
  }

  private async render(): Promise<void> {
    const generation = ++this.generation
    const current = (): boolean => !this.disposed && generation === this.generation
    this.svg = ''
    this.clearImage()
    this.el.replaceChildren(loadingNote('Drawing the diagram…'))
    try {
      if (this.spec.kind === 'plantuml') {
        const status = await api.diagramStatus()
        if (!current()) return
        if (!status.java) {
          const link = h('a', { href: '#', onClick: (event) => { event.preventDefault(); this.hooks.openLink('https://learn.microsoft.com/java/openjdk/download') } }, 'Get Microsoft OpenJDK')
          this.el.replaceChildren(h('div', { class: 'diagram-setup' }, h('p', {}, 'Install Java to see this diagram'), link), this.source())
          return
        }
        if (!status.jar) {
          if (status.jarOverride) {
            this.el.replaceChildren(h('div', { class: 'diagram-setup', role: 'status' }, h('p', {}, 'PlantUML jar was not found. Check its path in Settings.')), this.source())
            return
          }
          const button = h('button', { type: 'button', class: 'btn small', id: this.spec.standalone ? 'diagram-download' : undefined }, 'Download')
          const note = h('div', { class: 'diagram-setup', role: 'status' }, h('p', {}, `Dawsha downloads PlantUML (MIT, about ${status.downloadMegabytes} MB) once to draw diagrams on this computer.`), button)
          button.addEventListener('click', () => {
            button.disabled = true
            button.textContent = 'Downloading…'
            void api.diagramDownload().then((result) => {
              if (!current()) return
              if (result.ok) this.ready = this.render()
              else { button.disabled = false; button.textContent = 'Download'; this.notice(result.error) }
            }).catch((error: Error) => { if (current()) { button.disabled = false; button.textContent = 'Download'; this.notice(error.message) } })
          })
          this.el.replaceChildren(note, this.source())
          return
        }
        const result = await api.diagramRender(this.spec.folder, this.spec.path, this.spec.text, this.spec.standalone ? undefined : this.spec.sourceLine)
        if (!current()) return
        if (!result.ok) {
          if (result.reason !== 'superseded') this.error(result.error, result.line)
          return
        }
        this.show(result.svg)
      } else {
        const svg = await renderMermaid(this.spec.text, currentBundle().theme.kind === 'dark', current)
        if (current()) this.show(svg)
      }
    } catch (error) {
      if (current()) this.error(error instanceof Error ? error.message : 'Could not draw this diagram.')
    }
  }

  private error(message: string, line?: number): void {
    const parsed = line ?? (Number(/(?:line|on line)\s+(\d+)/i.exec(message)?.[1]) || undefined)
    const targetLine = parsed ? (this.spec.sourceLine ?? 1) + parsed - 1 : undefined
    const note = h('div', { class: 'diagram-error', role: 'alert' }, h('p', { dir: 'auto' }, message))
    if (targetLine && this.hooks.source) note.append(h('button', { type: 'button', class: 'btn small diagram-error-line', onClick: () => this.hooks.source?.(targetLine) }, `Line ${targetLine}`))
    note.append(h('button', { type: 'button', class: 'btn small', onClick: () => { this.ready = this.render() } }, 'Retry'))
    this.el.replaceChildren(note, this.source())
  }

  private show(svg: string): void {
    this.sourceShown = false
    this.svg = sanitizeDiagramSvg(svg)
    if (!this.svg) { this.error('Could not draw this diagram.'); return }
    // Mermaid uses width="100%". Give image mode intrinsic dimensions from its
    // viewBox so fit, scrolling and PNG export preserve the complete diagram.
    const parsed = new DOMParser().parseFromString(this.svg, 'image/svg+xml')
    const root = parsed.documentElement
    const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    if (root.localName === 'svg' && box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
      root.setAttribute('width', String(box[2]))
      root.setAttribute('height', String(box[3]))
      root.style.removeProperty('max-width')
      this.svg = new XMLSerializer().serializeToString(root)
    }
    this.imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.svg)}`
    const image = h('img', { class: 'diagram-image', id: this.spec.standalone ? 'diagram-image' : undefined, src: this.imageUrl, alt: `Diagram from ${this.spec.path}`, draggable: 'false' })
    this.image = image
    const canvas = h('div', { class: `diagram-canvas ${this.spec.kind}` }, image)
    this.canvas = canvas
    const stage = h('div', { class: 'diagram-stage', tabindex: '0', role: 'region', 'aria-label': 'Diagram. Control and mouse wheel to zoom. Drag to pan when zoomed.' }, canvas)
    this.stage = stage
    const id = (suffix: string): string | undefined => this.spec.standalone ? `diagram-${suffix}` : undefined
    this.zoomValue = h('span', { class: 'diagram-zoom-value', 'aria-live': 'polite' }, '100%')
    const bar = h('div', { class: 'diagram-toolbar' },
      h('span', { class: 'diagram-label' }, this.spec.kind === 'plantuml' ? 'PlantUML' : 'Mermaid'),
      h('button', { class: 'btn small', type: 'button', id: id('zoom-out'), 'aria-label': 'Zoom out', title: 'Zoom out', onClick: () => this.zoom(this.scale / 1.25) }, '−'),
      this.zoomValue,
      h('button', { class: 'btn small', type: 'button', id: id('zoom-in'), 'aria-label': 'Zoom in', title: 'Zoom in', onClick: () => this.zoom(this.scale * 1.25) }, '+'),
      h('button', { class: 'btn small', type: 'button', id: id('fit'), title: 'Fit to width (Ctrl+0)', onClick: () => this.zoom(1) }, 'Fit'))
    if (!this.spec.standalone) {
      const toggle = h('button', { class: 'btn small diagram-source-toggle', type: 'button', 'aria-pressed': 'false' }, 'Source')
      const source = this.source()
      source.hidden = true
      toggle.addEventListener('click', () => {
        this.sourceShown = !this.sourceShown
        source.hidden = !this.sourceShown
        stage.hidden = this.sourceShown
        toggle.textContent = this.sourceShown ? 'Diagram' : 'Source'
        toggle.setAttribute('aria-pressed', String(this.sourceShown))
        if (!this.sourceShown && this.themeDirty) {
          this.themeDirty = false
          this.ready = this.render()
        }
      })
      bar.append(toggle)
      this.el.replaceChildren(bar, stage, source)
    } else this.el.replaceChildren(bar, stage)
    this.scale = 1
    image.addEventListener('load', () => this.layout())
    image.addEventListener('error', () => { if (!this.disposed) this.error('Could not display the diagram image.') })
    stage.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      this.zoom(this.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
    }, { passive: false })
    let drag: { x: number; y: number; left: number; top: number } | null = null
    stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.scale <= 1) return
      drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }
      stage.setPointerCapture(event.pointerId)
      stage.classList.add('dragging')
    })
    stage.addEventListener('pointermove', (event) => {
      if (!drag) return
      stage.scrollLeft = drag.left - event.clientX + drag.x
      stage.scrollTop = drag.top - event.clientY + drag.y
    })
    const stopDrag = (): void => { drag = null; stage.classList.remove('dragging') }
    stage.addEventListener('pointerup', stopDrag)
    stage.addEventListener('pointercancel', stopDrag)
    this.observer = new ResizeObserver(() => this.layout())
    this.observer.observe(stage)
    this.layout()
  }

  private zoom(value: number): void {
    this.scale = Math.max(0.25, Math.min(8, value))
    this.layout()
  }

  private layout(): void {
    if (!this.stage || !this.image || !this.canvas) return
    const fit = Math.max(80, this.stage.clientWidth - 48)
    const width = Math.min(this.image.naturalWidth || fit, fit) * this.scale
    this.image.style.width = `${width}px`
    this.canvas.style.width = `${width}px`
    this.stage.classList.toggle('zoomed', this.scale > 1)
    if (this.zoomValue) this.zoomValue.textContent = `${Math.round(this.scale * 100)}%`
    if (this.scale === 1) { this.stage.scrollLeft = 0; this.stage.scrollTop = 0 }
  }
}
