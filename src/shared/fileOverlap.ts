import { normalizeFolder } from './folderKey'

/** One edit a session made to a file in its checkout. */
export interface OverlapEdit {
  paneId: string
  /** The checkout's real path; sessions in separate worktrees have separate ones. */
  checkout: string
  /** Repo-relative path with forward slashes. */
  file: string
  at: number
}

export interface OverlapWarning {
  /** The session that sees the warning. */
  paneId: string
  /** The other session that changed the same file. */
  otherPaneId: string
  file: string
  /** When the other session last changed it. */
  at: number
}

/** How far apart an edit and now may be for the file to count as in play. */
export const OVERLAP_WINDOW_MS = 30 * 60_000

const sameCheckout = (a: string, b: string): boolean => normalizeFolder(a) === normalizeFolder(b)

/** Files two or more sessions in the same checkout edited within the window; each side is warned about the other. */
export function findOverlaps(edits: readonly OverlapEdit[], now: number, windowMs: number = OVERLAP_WINDOW_MS): OverlapWarning[] {
  const recent = edits.filter((edit) => now - edit.at <= windowMs)
  const warnings: OverlapWarning[] = []
  for (const edit of recent) {
    const others = recent.filter((other) => other.paneId !== edit.paneId && other.file === edit.file && sameCheckout(other.checkout, edit.checkout))
    if (others.length === 0) continue
    if (warnings.some((warning) => warning.paneId === edit.paneId && warning.file === edit.file)) continue
    const latest = others.reduce((a, b) => (b.at > a.at ? b : a))
    warnings.push({ paneId: edit.paneId, otherPaneId: latest.paneId, file: edit.file, at: latest.at })
  }
  return warnings
}

export const warningKey = (warning: Pick<OverlapWarning, 'paneId' | 'file'>): string => `${warning.paneId}\n${warning.file}`

export const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1)

export function overlapLine(file: string, at: number, otherTitle: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  const hours = Math.floor(minutes / 60)
  const when = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'} ago` : `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${baseName(file)} changed ${when} by ${otherTitle}, in the same checkout`
}

export const overlapTell = (file: string): string => `Another session just changed ${baseName(file)}. Re-read it before you edit it again.`
