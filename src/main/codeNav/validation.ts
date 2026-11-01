import type { CodeNavRequest } from '../../shared/codeNav'
import { validateRepoPaths } from '../../shared/gitStatus'
import { MAX_READ_BYTES } from '../gitWorkspace'

export function validateCodeNavRequest(raw: unknown): CodeNavRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (!['definition', 'implementation', 'references'].includes(String(value.kind))) return null
  if (typeof value.path !== 'string' || !validateRepoPaths([value.path]).ok || value.path.includes(':')) return null
  if (typeof value.symbol !== 'string' || !/^[\p{L}\p{N}_$@]+$/u.test(value.symbol) || value.symbol.length > 200) return null
  if (!Number.isSafeInteger(value.line) || (value.line as number) <= 0 || !Number.isSafeInteger(value.column) || (value.column as number) <= 0) return null
  if (value.unsavedText !== undefined && (typeof value.unsavedText !== 'string' || Buffer.byteLength(value.unsavedText) > MAX_READ_BYTES)) return null
  return { kind: value.kind as CodeNavRequest['kind'], path: value.path, symbol: value.symbol, line: value.line as number, column: value.column as number, ...(value.unsavedText !== undefined ? { unsavedText: value.unsavedText as string } : {}) }
}
