export type PreviewKind = 'markdown' | 'html' | 'image'

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024

const extension = (path: string): string => path.slice(path.lastIndexOf('.') + 1).toLowerCase()

export function previewKind(path: string): PreviewKind | null {
  if (!path.includes('.')) return null
  const ext = extension(path)
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  return ext in IMAGE_TYPES ? 'image' : null
}

export const imageMime = (path: string): string | null => IMAGE_TYPES[extension(path)] ?? null

export const isHtmlPath = (path: string): boolean => previewKind(path) === 'html'

/** Docs open as a rendered page; code and HTML open as source until the user asks for the preview. */
export const previewByDefault = (path: string): boolean => previewKind(path) === 'markdown' || previewKind(path) === 'image'

// No network, no frames, no forms and no navigation: the page can run its own scripts and show inline styles, images and fonts it carries.
export const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'; frame-src 'none'"

/** The srcdoc for the sandboxed HTML preview: the policy comes first, so nothing in the file can come before it. */
export function htmlPreviewDocument(source: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">${source}`
}

export const HTML_PREVIEW_SANDBOX = 'allow-scripts'

export type FileImageResult = { ok: true; dataUrl: string; size: number } | { ok: false; error: string }

export interface FileCommit {
  hash: string
  short: string
  author: string
  at: number
  subject: string
}

export type FileLogResult = { ok: true; commits: FileCommit[] } | { ok: false; error: string }
