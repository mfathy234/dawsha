/** Only the app's own window may use the microphone, and only for audio. Everything else stays denied. */
export function isMediaPermissionAllowed(
  permission: string,
  requestingUrl: string,
  details: { mediaTypes?: string[] },
  appUrl: string
): boolean {
  if (permission !== 'media') return false
  if ((details.mediaTypes ?? []).some((type) => type !== 'audio')) return false
  return sameDocument(requestingUrl, appUrl)
}

function sameDocument(a: string, b: string): boolean {
  try {
    const left = new URL(a)
    const right = new URL(b)
    if (left.protocol === 'file:' && right.protocol === 'file:') return left.pathname === right.pathname
    return left.origin === right.origin
  } catch {
    return false
  }
}
