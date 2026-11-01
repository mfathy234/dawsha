const SECRET_WORDS = new Set([
  'password', 'passwd', 'pwd', 'pass', 'passphrase', 'secret', 'secrets', 'token', 'tokens', 'key', 'keys', 'apikey', 'accesskey', 'secretkey', 'privatekey',
  'connectionstring', 'connstr', 'credential', 'credentials', 'bearer', 'salt', 'sas', 'signature', 'cert', 'certificate', 'pfx', 'dsn', 'auth', 'authorization'
])

const SECRET_JOINED = /(password|passwd|secret|token|apikey|accesskey|privatekey|connectionstring|credential|signingkey|encryptionkey)/i

const SECRET_SHAPES: readonly RegExp[] = [
  /^eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*$/,
  /^(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{16,}$/,
  /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/,
  /^github_pat_[A-Za-z0-9_]{20,}$/,
  /^xox[abprs]-[A-Za-z0-9-]{10,}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /^AIza[0-9A-Za-z_-]{30,}$/,
  /^-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(^|[;\s])(password|pwd|accountkey|sharedaccesskey|secret|client_secret)\s*=\s*[^;\s]+/i,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /^[A-Fa-f0-9]{40,}$/,
  /^[A-Za-z0-9+/_-]{40,}={0,2}$/
]

function keySegments(key: string): string[] {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return spaced.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part.toLowerCase())
}

/** True when the key's name reads like a secret: a whole word such as Password or Key, or a joined form such as ConnectionString. */
export function secretKeyName(key: string): boolean {
  const segments = keySegments(key)
  if (segments.some((segment) => SECRET_WORDS.has(segment))) return true
  for (let i = 0; i + 1 < segments.length; i++) if (SECRET_WORDS.has(segments[i] + segments[i + 1])) return true
  return SECRET_JOINED.test(key.replace(/[^A-Za-z0-9]+/g, ''))
}

/** True when the value looks like a credential whatever the key is called. */
export function secretValueShape(value: string): boolean {
  const text = value.trim()
  if (text.length < 8) return false
  const spaced = /\s/.test(text)
  if (spaced && !/(password|pwd|accountkey)\s*=/i.test(text) && !text.startsWith('-----BEGIN')) return false
  return SECRET_SHAPES.some((shape) => shape.test(text))
}

export const isSecretConfig = (key: string, value: string): boolean => secretKeyName(key) || secretValueShape(value)
