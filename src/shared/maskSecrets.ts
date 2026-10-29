export const MASK_MAX_LENGTH = 120

const MASK = '[masked]'

const RULES: [RegExp, string][] = [
  [/\bBearer\s+\S+/gi, `Bearer ${MASK}`],
  [/\b(token|key|password|passwd|secret|api[_-]?key)=[^\s"'&]+/gi, `$1=${MASK}`],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, `sk-${MASK}`],
  [/\b[0-9a-fA-F]{24,}\b/g, MASK],
  [/\b(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[A-Za-z])[A-Za-z0-9+/]{24,}={0,2}/g, MASK]
]

/** Hides obvious secrets in a line of activity text, then cuts it to MASK_MAX_LENGTH characters. */
export function maskSecrets(text: string): string {
  const masked = RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
  return masked.length > MASK_MAX_LENGTH ? `${masked.slice(0, MASK_MAX_LENGTH - 1)}…` : masked
}
