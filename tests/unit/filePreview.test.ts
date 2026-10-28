import { describe, expect, it } from 'vitest'
import { HTML_PREVIEW_CSP, HTML_PREVIEW_SANDBOX, htmlPreviewDocument, imageMime, previewByDefault, previewKind } from '../../src/shared/filePreview'

describe('previewKind', () => {
  it('knows documents, pages and images', () => {
    expect(previewKind('docs/plan.md')).toBe('markdown')
    expect(previewKind('a/B.HTML')).toBe('html')
    for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg']) expect(previewKind(name)).toBe('image')
    for (const name of ['a.ts', 'README', 'md', 'a.mdx']) expect(previewKind(name)).toBeNull()
  })
  it('opens docs and images as a preview but html as source', () => {
    expect(previewByDefault('a.md')).toBe(true)
    expect(previewByDefault('a.png')).toBe(true)
    expect(previewByDefault('a.html')).toBe(false)
    expect(previewByDefault('a.ts')).toBe(false)
  })
  it('gives image mime types, svg as an image type', () => {
    expect(imageMime('x.svg')).toBe('image/svg+xml')
    expect(imageMime('x.jpg')).toBe('image/jpeg')
    expect(imageMime('x.ts')).toBeNull()
  })
})

describe('html preview isolation', () => {
  it('sandboxes with scripts only: no same-origin, navigation, forms or popups', () => {
    expect(HTML_PREVIEW_SANDBOX).toBe('allow-scripts')
    for (const word of ['same-origin', 'top-navigation', 'forms', 'popups']) expect(HTML_PREVIEW_SANDBOX).not.toContain(word)
  })
  it('puts a policy with no network first in the document', () => {
    const doc = htmlPreviewDocument('<script>fetch("https://x")</script>')
    expect(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(HTML_PREVIEW_CSP).toContain("default-src 'none'")
    expect(HTML_PREVIEW_CSP).not.toMatch(/connect-src|https?:/)
    expect(HTML_PREVIEW_CSP).toContain("form-action 'none'")
    expect(HTML_PREVIEW_CSP).toContain("frame-src 'none'")
  })
})
