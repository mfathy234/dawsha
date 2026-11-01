import { parseUnifiedDiff } from '../../shared/diffView'
import type { CodeNavHit, CodeNavRequest } from '../../shared/codeNav'
import type { StaleCaller, StaleCallersResult } from '../../shared/codeNavExtras'
import { git, repoRoot } from '../gitCommit'
import { fileAgainstBase, mergeBase, resolveProjectFile } from '../gitWorkspace'
import { changedSymbols, type ChangedSymbol } from './changedSymbols'
import { nameSearch } from './nameSearch'
import type { CodeNavRouter } from './router'
import { validRelative } from './editPreviews'

interface Options { timeoutMs?: number; symbolCap?: number }
interface Candidate { symbol: ChangedSymbol; deleted: boolean }
const DEFAULT_MS = 5000
const SYMBOL_CAP = 30
const pathKey = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path

async function candidates(folder: string, path: string, root: string, base: string, limit: number, deadline: number): Promise<Candidate[]> {
  const read = await fileAgainstBase(folder, path)
  if (!read.ok || Date.now() >= deadline) return []
  const diff = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', base, '--', path], Math.max(1, deadline - Date.now()))
  if (Date.now() >= deadline) return []
  const hunks = parseUnifiedDiff(diff.stdout)
  const added = new Set(hunks.flatMap(hunk => hunk.lines.filter(line => line.kind === 'add').map(line => line.newNo!)))
  const removed = new Set(hunks.flatMap(hunk => hunk.lines.filter(line => line.kind === 'del').map(line => line.oldNo!)))
  if (read.base === null) read.text.split(/\r\n|\r|\n/).forEach((_line, index) => added.add(index + 1))
  const previous = await changedSymbols(path, read.base ?? '', removed, { limit, deadline })
  const current = await changedSymbols(path, read.text, added, { limit, deadline, names: previous.map(symbol => symbol.name) })
  const out: Candidate[] = current.map(symbol => ({ symbol, deleted: false }))
  for (const symbol of previous) {
    if (current.some(value => value.name === symbol.name)) continue
    // A removal inside a surviving function is still a changed symbol, with its current position.
    out.push({ symbol, deleted: true })
  }
  return out
}

async function scan(folder: string, navigation: Pick<CodeNavRouter, 'query'>, cap: number, out: StaleCaller[], progress: { scanned: number; expired: boolean; deadline: number }): Promise<'symbolCap' | 'timeout' | undefined> {
  const root = await repoRoot(folder)
  if (progress.expired) return 'timeout'
  const base = root ? await mergeBase(root) : null
  if (progress.expired) return 'timeout'
  if (!root || !base) return
  const tracked = await git(root, ['diff', '--name-only', '-z', '--no-renames', base, '--'], Math.max(1, progress.deadline - Date.now()))
  if (progress.expired) return 'timeout'
  const untracked = await git(root, ['ls-files', '-o', '--exclude-standard', '-z'], Math.max(1, progress.deadline - Date.now()))
  if (progress.expired) return 'timeout'
  const paths = [...new Set((tracked.stdout + untracked.stdout).split('\0').filter(validRelative))]
  const changed = new Set(paths.map(pathKey))
  for (const path of paths) {
    if (progress.expired) return
    const resolved = await resolveProjectFile(folder, path)
    if (!resolved.ok && !resolved.missing) continue
    const found = await candidates(folder, path, root, base, cap - progress.scanned + 1, progress.deadline)
    if (progress.expired || Date.now() >= progress.deadline) return 'timeout'
    for (const candidate of found) {
      if (progress.expired || Date.now() >= progress.deadline) return 'timeout'
      if (progress.scanned >= cap) return 'symbolCap'
      const { symbol, deleted } = candidate
      const request = { path, symbol: symbol.name, line: symbol.line, column: symbol.column }
      const query = (kind: CodeNavRequest['kind']) => deleted ? nameSearch(folder, { ...request, kind }) : navigation.query(folder, { ...request, kind })
      const refs = await query('references')
      if (progress.expired) return
      const impls = await query('implementation')
      if (progress.expired) return
      progress.scanned++
      const untouched = (hits: CodeNavHit[]): CodeNavHit[] => hits.filter(hit => !changed.has(pathKey(hit.path)))
      const references = refs.ok ? untouched(refs.hits) : []
      const implementations = impls.ok ? untouched(impls.hits) : []
      const engine = refs.ok && impls.ok && refs.engine === impls.engine ? refs.engine : 'name'
      if (references.length || implementations.length) out.push({ symbol: { path, line: symbol.line, column: symbol.column, preview: symbol.preview }, references, implementations, engine })
    }
  }
}

/** The timeout also bounds slow server/grep/git operations; at most one query remains pending after it expires. */
export async function staleCallers(folder: string, navigation: Pick<CodeNavRouter, 'query'>, options: Options = {}): Promise<StaleCallersResult> {
  const symbols: StaleCaller[] = []
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_MS, 15_000))
  const progress = { scanned: 0, expired: false, deadline: Date.now() + timeoutMs }
  const cap = Math.max(1, Math.min(options.symbolCap ?? SYMBOL_CAP, 100))
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => { progress.expired = true; resolve('timeout') }, timeoutMs) })
  try {
    const reason = await Promise.race([scan(folder, navigation, cap, symbols, progress), timeout])
    return { ok: true, symbols: [...symbols], scannedSymbols: progress.scanned, stoppedEarly: reason !== undefined, ...(reason ? { reason } : {}) }
  } catch { return { ok: false, error: 'Could not inspect changed symbols.' } }
  finally { clearTimeout(timer) }
}
