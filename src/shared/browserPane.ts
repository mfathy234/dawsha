export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserState {
  open: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  errorCount: number
  /** Why the last navigation failed, or null. */
  failure: string | null
}

export type BrowserCommand =
  | { type: 'open'; url: string | null }
  | { type: 'bounds'; bounds: BrowserBounds; visible: boolean }
  | { type: 'navigate'; url: string }
  | { type: 'back' | 'forward' | 'reload' | 'stop' | 'devtools' | 'close' }
  | { type: 'screenshot' }
  | { type: 'errors' }

export type BrowserResult =
  | { ok: true; state: BrowserState }
  | { ok: false; error: string }

export type BrowserCapture =
  | { ok: true; path: string; url: string }
  | { ok: false; error: string }

export type BrowserErrors =
  | { ok: true; lines: string[]; url: string }
  | { ok: false; error: string }

export const CLOSED_BROWSER: BrowserState = { open: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, errorCount: 0, failure: null }

export const BROWSER_PARTITION = 'dawsha-browser'
export const MAX_URL_LENGTH = 2048
export const MAX_CONSOLE_ERRORS = 50

const WEB_PROTOCOLS = new Set(['http:', 'https:'])
const OTHER_SCHEME = /^(javascript|data|file|about|blob|mailto|view-source|chrome|devtools|ftp|ws|wss|vbscript|filesystem|intent|tel|sms):/i
const HOST_PORT = /^(?:localhost|[\w.-]+|\[[0-9a-f:]+\]):\d{1,5}(?:[/?#]|$)/i
const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|[\w-]+\.local)(?::\d+)?(?:[/?#]|$)/i

/** True for the only addresses the browser pane may load. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return WEB_PROTOCOLS.has(url.protocol) && url.hostname !== '' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** What the address bar typed becomes: a full http or https address, or the reason it is refused. */
export function parseBrowserAddress(input: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof input !== 'string') return { ok: false, error: 'Type an address.' }
  const typed = input.trim()
  if (typed === '') return { ok: false, error: 'Type an address.' }
  if (typed.length > MAX_URL_LENGTH) return { ok: false, error: 'That address is too long.' }
  if (/[\u0000-\u001f\u007f\s]/.test(typed)) return { ok: false, error: 'Addresses cannot contain spaces.' }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) || (OTHER_SCHEME.test(typed) && !HOST_PORT.test(typed))
  const candidate = hasScheme ? typed : `${LOCAL_HOST.test(typed) ? 'http' : 'https'}://${typed}`
  try {
    const url = new URL(candidate)
    if (!WEB_PROTOCOLS.has(url.protocol)) return { ok: false, error: 'Only http and https addresses can be opened.' }
    if (url.username !== '' || url.password !== '') return { ok: false, error: 'Addresses with a user name or password are not opened.' }
    if (url.hostname === '') return { ok: false, error: 'That address has no host.' }
    return { ok: true, url: url.href }
  } catch {
    return { ok: false, error: 'That is not a valid address.' }
  }
}

export function validBounds(value: unknown): value is BrowserBounds {
  if (value === null || typeof value !== 'object') return false
  const box = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => typeof box[key] === 'number' && Number.isFinite(box[key] as number) && Math.abs(box[key] as number) < 100_000)
}

export function errorsMessage(url: string, errors: readonly string[]): string {
  const shown = errors.slice(-MAX_CONSOLE_ERRORS)
  return `These console errors came from ${url} in the Dawsha browser:\n${shown.map((line) => `- ${line}`).join('\n')} `
}

export const screenshotMessage = (path: string, url: string): string => `Screenshot of ${url} from the Dawsha browser: ${path} `
