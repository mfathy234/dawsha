export interface TerminalProgress {
  state: 0 | 1 | 2 | 3 | 4
  percent: number
}

export function oscDirectory(data: string): string | null {
  try {
    const url = new URL(data)
    if (url.protocol !== 'file:' || url.username || url.password || url.search || url.hash) return null
    const path = decodeURIComponent(url.pathname)
    if (!path.startsWith('/') || /^[\/\\]{2}/.test(path) || /[\\\x00-\x1f\x7f]/.test(path)) return null
    return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
  } catch { return null }
}

export function oscProgress(data: string): TerminalProgress | null {
  const match = /^4;([0-4])(?:;(\d{1,3}))?$/.exec(data)
  if (!match) return null
  const percent = Number(match[2] ?? 0)
  if (percent > 100) return null
  return { state: Number(match[1]) as TerminalProgress['state'], percent }
}

export function clipboardWrite(data: string): string | null {
  const separator = data.indexOf(';')
  if (separator < 0 || !/^[cps0-7]*$/.test(data.slice(0, separator))) return null
  const encoded = data.slice(separator + 1)
  if (encoded === '?' || encoded.length > 1_398_104 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return null }
}
