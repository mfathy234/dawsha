import { HTML_PREVIEW_SANDBOX, type PreviewKind } from '../../shared/filePreview'
import { renderDocMarkdown } from '../../shared/docMarkdown'
import { api } from '../api'
import { h } from '../dom'

export interface PreviewSpec {
  kind: PreviewKind
  folder: string
  path: string
  text: string
  /** The image differs from main, so it can be compared. */
  changed: boolean
}

export interface PreviewHooks {
  openBrowser(): void
  openLink(url: string): void
}

const key = (spec: PreviewSpec): string => `${spec.kind}|${spec.folder}|${spec.path}|${spec.changed}|${spec.text.length}|${spec.kind === 'image' && spec.text === '' ? '' : spec.text.slice(0, 200)}${spec.text.slice(-200)}`

/** Rendered markdown, a sandboxed HTML page, or an image (with a before / after split for a changed one). */
export class PreviewPane {
  readonly el = h('div', { class: 'files-preview', id: 'files-preview', hidden: true })
  private last = ''
  private token = 0

  constructor(private readonly hooks: PreviewHooks) {
    this.el.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('a[data-href]')
      if (!link) return
      event.preventDefault()
      this.hooks.openLink(link.dataset.href ?? '')
    })
  }

  hide(): void {
    this.el.hidden = true
  }

  render(spec: PreviewSpec): void {
    this.el.hidden = false
    const next = key(spec)
    if (next === this.last) return
    this.last = next
    const token = ++this.token
    if (spec.kind === 'markdown') this.markdown(spec)
    else if (spec.kind === 'html') void this.html(spec, token)
    else void this.image(spec, token)
  }

  private markdown(spec: PreviewSpec): void {
    const page = h('article', { class: 'files-md', id: 'files-md', 'aria-label': `Preview of ${spec.path}` })
    page.innerHTML = renderDocMarkdown(spec.text)
    this.el.replaceChildren(page)
  }

  private async html(spec: PreviewSpec, token: number): Promise<void> {
    const made = await api.filePreviewUrl(spec.folder, spec.path, spec.text).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (token !== this.token) return
    const bar = h('div', { class: 'files-preview-bar' },
      h('span', { class: 'files-preview-note' }, 'Runs in a sandbox with no network.'),
      h('button', { class: 'btn small', type: 'button', id: 'files-open-browser', onClick: () => this.hooks.openBrowser() }, 'Open in browser'))
    if (!made.ok) {
      this.el.replaceChildren(bar, h('p', { class: 'files-side-empty', role: 'status' }, made.error))
      return
    }
    const frame = h('iframe', { class: 'files-html', id: 'files-html', title: `Preview of ${spec.path}`, sandbox: HTML_PREVIEW_SANDBOX, referrerpolicy: 'no-referrer' })
    frame.src = made.url
    this.el.replaceChildren(bar, frame)
  }

  private async image(spec: PreviewSpec, token: number): Promise<void> {
    this.el.replaceChildren(h('p', { class: 'files-side-empty' }, 'Loading…'))
    const current = await api.fileImage(spec.folder, spec.path, false).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (token !== this.token) return
    if (!current.ok) {
      this.el.replaceChildren(h('p', { class: 'files-side-empty', role: 'status' }, current.error))
      return
    }
    const picture = h('img', { class: 'files-image', id: 'files-image', alt: spec.path, src: current.dataUrl })
    const stage = h('div', { class: 'files-image-stage' }, picture)
    const bar = h('div', { class: 'files-preview-bar' }, h('span', { class: 'files-preview-note' }, `${spec.path} · ${Math.max(1, Math.round(current.size / 1024))} KB`))
    if (spec.changed) {
      const compare = h('button', { class: 'btn small', type: 'button', id: 'files-compare-main', 'aria-pressed': 'false' }, 'Compare with main')
      compare.addEventListener('click', () => void this.compare(spec, current.dataUrl, stage, picture, compare, token))
      bar.append(compare)
    }
    this.el.replaceChildren(bar, stage)
  }

  private async compare(spec: PreviewSpec, now: string, stage: HTMLElement, picture: HTMLElement, button: HTMLElement, token: number): Promise<void> {
    if (button.getAttribute('aria-pressed') === 'true') {
      button.setAttribute('aria-pressed', 'false')
      button.textContent = 'Compare with main'
      stage.replaceChildren(picture)
      return
    }
    const base = await api.fileImage(spec.folder, spec.path, true).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (token !== this.token) return
    if (!base.ok) {
      stage.replaceChildren(picture, h('p', { class: 'files-side-empty', role: 'status' }, base.error))
      return
    }
    button.setAttribute('aria-pressed', 'true')
    button.textContent = 'Back to the image'
    const before = h('img', { class: 'files-compare-img before', alt: 'On main', src: base.dataUrl })
    const after = h('img', { class: 'files-compare-img after', alt: 'Your version', src: now })
    const range = h('input', { class: 'files-compare-range', id: 'files-compare-range', type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Drag to compare main (left) with your version (right)' })
    const frame = h('div', { class: 'files-compare', id: 'files-compare' }, after, before, h('div', { class: 'files-compare-line', 'aria-hidden': 'true' }), range,
      h('span', { class: 'files-compare-tag left' }, 'Main'), h('span', { class: 'files-compare-tag right' }, 'Now'))
    const sync = (): void => {
      frame.style.setProperty('--split', `${range.value}%`)
    }
    range.addEventListener('input', sync)
    sync()
    stage.replaceChildren(frame)
  }
}
