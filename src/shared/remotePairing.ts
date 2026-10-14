// Pairing links put the code in the URL fragment. Browsers never send the fragment to a
// server, so the code stays out of Cloudflare and Dawsha request logs.
const CODE = /^[0-9]{6}$/

export function pairingLink(url: string, code?: string | null): string {
  const base = url.split('#')[0]
  return code && CODE.test(code) ? `${base}#pair=${code}` : base
}

export function pairingCodeFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const code = params.get('pair')
  return code && CODE.test(code) ? code : null
}

// A readable default name for the paired browser, such as "iPhone · Safari".
export function deviceNameFromAgent(userAgent: string): string {
  const ua = userAgent
  const device = /iPad/.test(ua) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? 'Android'
        : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
          : /Windows/.test(ua) ? 'Windows'
            : /Linux/.test(ua) ? 'Linux'
              : 'Browser'
  const browser = /EdgA?\//.test(ua) ? 'Edge'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari'
            : ''
  return browser ? `${device} · ${browser}` : device
}
