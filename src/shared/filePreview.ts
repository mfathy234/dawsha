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

// The page is served from the dawsha-preview scheme, whose responses carry their own policy (see main/filePreviewServer).
// The frame is sandboxed with scripts only: no same-origin access, no navigation of the app, no popups, no forms.
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
