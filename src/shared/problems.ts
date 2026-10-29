export type ProblemSeverity = 'error' | 'warning' | 'info'
export type ProblemSource = 'typescript' | 'eslint' | 'dotnet' | 'test' | 'generic'

export interface Problem {
  severity: ProblemSeverity
  /** The path as the tool printed it; resolve it with resolveProblemFile. */
  file: string
  line: number
  column?: number
  message: string
  source: ProblemSource
  code?: string
}

export interface ParseOptions {
  /** Whether a stack frame's path belongs to the project; frames in node_modules and node internals are always skipped. */
  accepts?: (file: string) => boolean
}

export const MAX_PROBLEMS = 500
const FAILURE_WINDOW = 40
const MAX_LINE_LENGTH = 2000

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

const TS_PAREN = /^\s*(\S.*?)\((\d+)(?:,(\d+))?(?:,\d+,\d+)?\):\s+(error|warning)\s+([A-Za-z]+\d+):\s*(.*?)\s*$/
const TS_PRETTY = /^\s*(\S.*?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s*(.*?)\s*$/
const ESLINT_UNIX = /^\s*(\S.*?):(\d+):(\d+):\s+(\S(?:.*?\S)?)\s+\[(Error|Warning)(?:\/([^\]]+))?\]\s*$/
const ESLINT_ROW = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)\s*$/
const MSBUILD_PROJECT = /\s+\[[^\]]*\.(?:csproj|vbproj|fsproj|sln|proj|props|targets)[^\]]*\]\s*$/i
const TEST_HEADER = /^\s*(FAIL|●)\s+(\S(?:.*\S)?)\s*$/
const FRAME = /^\s*(?:❯|at)\s+(?:.*?\()?(.+?):(\d+):(\d+)\)?\s*$/
const ERROR_LINE = /^\s*((?:[A-Za-z]*(?:Error|Exception)\b.*)|(?:expect\(.*))$/
const GENERIC = /^\s*((?:[A-Za-z]:)?[^\s:()'"<>|*?]+?):(\d+)(?::(\d+))?(?::|\s+-)\s*(.+?)\s*$/
const SEVERITY_WORD = /^(?:fatal\s+)?(error|warning|warn|note|info|hint)\b[^:]*:?\s*(.*)$/i

const severityOf = (word: string): ProblemSeverity => {
  const lower = word.toLowerCase()
  if (lower === 'error') return 'error'
  if (lower === 'warning' || lower === 'warn') return 'warning'
  return 'info'
}

const looksLikeFile = (path: string): boolean => /\.[A-Za-z0-9]+$/.test(path) || path.includes('/') || path.includes('\\')

const isFrameworkPath = (file: string): boolean => /(?:^|[\\/])node_modules[\\/]/.test(file) || file.startsWith('node:')

interface Pending {
  title: string
  error: string
  seen: number
}

const testTitle = (header: string): string => {
  const at = header.indexOf(' > ')
  return at >= 0 ? header.slice(at + 3).trim() : ''
}

/** Problems a run printed: TypeScript, ESLint, .NET, test failures and generic file:line lines. Never throws. */
export function parseProblems(output: string, options: ParseOptions = {}): Problem[] {
  const out: Problem[] = []
  const seen = new Set<string>()
  const accepts = options.accepts ?? (() => true)
  let eslintFile = ''
  let pending: Pending | null = null
  const add = (problem: Problem): void => {
    const key = `${problem.source}|${problem.file}|${problem.line}|${problem.column ?? ''}|${problem.message}`
    if (seen.has(key) || out.length >= MAX_PROBLEMS) return
    seen.add(key)
    out.push(problem)
  }
  for (const raw of output.replace(ANSI, '').split(/\r?\n/)) {
    if (out.length >= MAX_PROBLEMS) break
    if (raw.length > MAX_LINE_LENGTH) {
      if (pending && ++pending.seen > FAILURE_WINDOW) pending = null
      continue
    }
    if (raw.trim() === '') {
      if (pending) pending.seen += 1
      continue
    }
    if (pending) {
      pending.seen += 1
      const frame = FRAME.exec(raw)
      if (frame && !isFrameworkPath(frame[1]) && accepts(frame[1])) {
        const message = pending.title && pending.error ? `${pending.title}: ${pending.error}` : pending.error || pending.title || 'Test failed'
        add({ severity: 'error', file: frame[1], line: Number(frame[2]), column: Number(frame[3]), message, source: 'test' })
        pending = null
        continue
      }
      if (frame) continue
      if (!pending.error) {
        const error = ERROR_LINE.exec(raw)
        if (error) pending.error = error[1].trim()
      }
      if (pending.seen > FAILURE_WINDOW) pending = null
    }
    const paren = TS_PAREN.exec(raw)
    if (paren) {
      const [, file, line, column, severity, code, rest] = paren
      const typescript = code.startsWith('TS')
      add({
        severity: severityOf(severity), file, line: Number(line), column: column ? Number(column) : undefined,
        message: typescript ? rest : rest.replace(MSBUILD_PROJECT, ''), source: typescript ? 'typescript' : 'dotnet', code
      })
      continue
    }
    const pretty = TS_PRETTY.exec(raw)
    if (pretty) {
      add({ severity: severityOf(pretty[4]), file: pretty[1], line: Number(pretty[2]), column: Number(pretty[3]), message: pretty[6], source: 'typescript', code: pretty[5] })
      continue
    }
    const unix = ESLINT_UNIX.exec(raw)
    if (unix) {
      add({ severity: severityOf(unix[5]), file: unix[1], line: Number(unix[2]), column: Number(unix[3]), message: unix[4], source: 'eslint', ...(unix[6] ? { code: unix[6] } : {}) })
      continue
    }
    const row = ESLINT_ROW.exec(raw)
    if (row && eslintFile) {
      const parts = row[4].split(/\s{2,}/)
      const code = parts.length > 1 && /^[@\w/.-]+$/.test(parts[parts.length - 1]) ? parts.pop() : undefined
      add({ severity: severityOf(row[3]), file: eslintFile, line: Number(row[1]), column: Number(row[2]), message: parts.join('  '), source: 'eslint', ...(code ? { code } : {}) })
      continue
    }
    if (!/^\s/.test(raw)) eslintFile = looksLikeFile(raw.trim()) && !/\s{2,}/.test(raw) ? raw.trim() : ''
    const header = TEST_HEADER.exec(raw)
    if (header) {
      pending = { title: header[1] === 'FAIL' ? testTitle(header[2]) : header[2], error: '', seen: 0 }
      continue
    }
    const generic = GENERIC.exec(raw)
    if (generic && looksLikeFile(generic[1])) {
      const word = SEVERITY_WORD.exec(generic[4])
      if (!word && !generic[3]) continue
      add({
        severity: word ? severityOf(word[1]) : 'error', file: generic[1], line: Number(generic[2]), column: generic[3] ? Number(generic[3]) : undefined,
        message: word ? word[2] || generic[4] : generic[4], source: 'generic'
      })
    }
  }
  return out
}

interface Split {
  drive: string
  parts: string[]
}

function split(path: string): Split | null {
  const flat = path.replace(/\\/g, '/')
  const drive = /^([A-Za-z]):(?:\/|$)/.exec(flat)
  if (drive) return { drive: drive[1].toLowerCase(), parts: flat.slice(2).split('/').filter(Boolean) }
  if (flat.startsWith('/')) return { drive: '', parts: flat.split('/').filter(Boolean) }
  return null
}

function normalise(parts: readonly string[]): string[] | null {
  const out: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(part)
  }
  return out
}

function fromUrl(file: string): string {
  if (!/^file:\/\//i.test(file)) return file
  try {
    const path = decodeURIComponent(new URL(file).pathname)
    return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path
  } catch {
    return file
  }
}

/** The path relative to the checkout (forward slashes), or null when the file is outside it, in node_modules or cannot be placed. */
export function resolveProblemFile(file: string, cwd: string, root: string): string | null {
  const cleaned = fromUrl(file.trim())
  if (cleaned === '' || cleaned.includes('\0')) return null
  const home = split(cwd)
  const top = split(root)
  if (!home || !top) return null
  const given = split(cleaned)
  const target = given ?? { drive: home.drive, parts: [...home.parts, ...cleaned.replace(/\\/g, '/').split('/').filter(Boolean)] }
  const parts = normalise(target.parts)
  const base = normalise(top.parts)
  if (!parts || !base || target.drive !== top.drive) return null
  const insensitive = top.drive !== ''
  const same = (a: string, b: string): boolean => (insensitive ? a.toLowerCase() === b.toLowerCase() : a === b)
  if (parts.length <= base.length || !base.every((part, index) => same(part, parts[index]))) return null
  const rest = parts.slice(base.length)
  return rest.includes('node_modules') ? null : rest.join('/')
}

export interface ProblemGroup {
  file: string
  items: Problem[]
}

/** Problems grouped by file, files in the order they first appear. */
export function groupProblems(problems: readonly Problem[]): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>()
  for (const problem of problems) {
    const group = groups.get(problem.file)
    if (group) group.items.push(problem)
    else groups.set(problem.file, { file: problem.file, items: [problem] })
  }
  return [...groups.values()]
}

export const problemsLabel = (count: number): string => (count > 0 ? `Problems ${count}` : 'Problems')
